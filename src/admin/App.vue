<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { availableLocales, localeStorageKey } from "./i18n";

const { t, locale } = useI18n();

const themeStorageKey = "pipink_admin_theme_mode";
const availableThemeModes = [
  { code: "system", labelKey: "admin.themeAuto" },
  { code: "light", labelKey: "admin.themeLight" },
  { code: "dark", labelKey: "admin.themeDark" }
];
const settingsTabs = [
  { code: "basic", labelKey: "admin.basicSettingsTab" },
  { code: "cache", labelKey: "admin.cacheSettingsTab" }
];
const DEFAULT_CACHE_TTL_SECONDS = 3600;
const cacheStatusRuleOptions = [
  { value: "100-199", label: "100-199" },
  { value: "200-299", label: "200-299" },
  { value: "300-399", label: "300-399" },
  { value: "400-499", label: "400-499" },
  { value: "500-599", label: "500-599" },
  { value: "200", label: "200" },
  { value: "201", label: "201" },
  { value: "204", label: "204" },
  { value: "301", label: "301" },
  { value: "302", label: "302" },
  { value: "304", label: "304" },
  { value: "400", label: "400" },
  { value: "401", label: "401" },
  { value: "403", label: "403" },
  { value: "404", label: "404" },
  { value: "429", label: "429" },
  { value: "500", label: "500" },
  { value: "502", label: "502" },
  { value: "503", label: "503" },
  { value: "504", label: "504" }
];

const apiErrorKeys = {
  "Unauthorized": "apiErrors.unauthorized",
  "Invalid JSON body": "apiErrors.invalidJsonBody",
  "targetUrl must be a valid http or https URL": "apiErrors.invalidTargetUrl",
  "accessToken must be a non-empty string": "apiErrors.invalidAccessToken",
  "cacheEnabled must be a boolean": "apiErrors.invalidCacheEnabled",
  "cacheTtlSeconds must be an integer greater than or equal to 1": "apiErrors.invalidCacheTtl",
  "cacheValidStatusRules must be an array of HTTP status codes or ranges": "apiErrors.invalidCacheStatusRules",
  "Method Not Allowed": "apiErrors.methodNotAllowed",
  "Access token is not configured": "apiErrors.accessTokenNotConfigured",
  "Target URL is not configured": "apiErrors.targetUrlNotConfigured"
};

const adminKey = ref("");
const targetUrl = ref("");
const accessToken = ref("");
const cacheEnabled = ref(false);
const cacheTtlSeconds = ref(DEFAULT_CACHE_TTL_SECONDS);
const cacheValidStatusRules = ref([]);
const lastCacheUpdatedAt = ref(null);
const activeSettingsTab = ref("basic");
const authenticated = ref(false);
const busy = ref(false);
const compactMenu = ref(null);
const themeMode = ref(detectThemeMode());
const statusMessage = ref("");
const statusError = ref(false);
const statusVisible = ref(false);
const toastMessage = ref("");
const toastVisible = ref(false);
const toastError = ref(false);

let toastTimer = null;
let systemThemeMediaQuery = null;

function normalizeThemeMode(value) {
  return ["system", "light", "dark"].includes(value) ? value : "system";
}

function detectThemeMode() {
  if (typeof window !== "undefined") {
    return normalizeThemeMode(window.localStorage.getItem(themeStorageKey));
  }

  return "system";
}

function getSystemTheme() {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  return "light";
}

const resolveMessage = (message, fallbackKey) => {
  const key = apiErrorKeys[message];
  return key ? t(key) : message || t(fallbackKey);
};

const applyDocumentLanguage = () => {
  document.documentElement.lang = locale.value === "zh" ? "zh-CN" : "en";
  document.title = t("admin.documentTitle");
};

const applyTheme = () => {
  const resolvedTheme = themeMode.value === "system" ? getSystemTheme() : themeMode.value;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themeMode = themeMode.value;
  document.documentElement.style.colorScheme = resolvedTheme;
};

const setLocale = (nextLocale) => {
  locale.value = nextLocale;
};

const setThemeMode = (nextThemeMode) => {
  themeMode.value = normalizeThemeMode(nextThemeMode);
};

const closeCompactMenu = () => {
  if (compactMenu.value?.open) {
    compactMenu.value.open = false;
  }
};

const setStatus = (message, isError = false) => {
  statusMessage.value = message;
  statusError.value = isError;
  statusVisible.value = true;
};

const hideStatus = () => {
  statusVisible.value = false;
  statusError.value = false;
};

const showToast = (message, isError = false) => {
  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastMessage.value = message;
  toastError.value = isError;
  toastVisible.value = true;

  toastTimer = setTimeout(() => {
    toastVisible.value = false;
    toastError.value = false;
  }, 2200);
};

const requireAdminKey = () => {
  const value = adminKey.value.trim();
  if (!value) {
    showToast(t("admin.enterAdminKey"), true);
    return null;
  }

  return value;
};

const generateAccessToken = (length = 32) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);

  let token = "";
  for (const byte of randomBytes) {
    token += alphabet[byte % alphabet.length];
  }

  return token;
};

const normalizeCacheTtlSeconds = (value) => {
  const nextValue = Number(value);
  return Number.isInteger(nextValue) && nextValue >= 1 ? nextValue : DEFAULT_CACHE_TTL_SECONDS;
};

const normalizeCacheValidStatusRules = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenValues = new Set();
  const allowedValues = new Set(cacheStatusRuleOptions.map((option) => option.value));

  return value.filter((item) => {
    if (typeof item !== "string" || seenValues.has(item) || !allowedValues.has(item)) {
      return false;
    }

    seenValues.add(item);
    return true;
  });
};

const normalizeCacheTimestamp = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  return Number.isNaN(Date.parse(value)) ? null : value;
};

const setActiveSettingsTab = (value) => {
  activeSettingsTab.value = value === "cache" ? "cache" : "basic";
};

const setCacheStatusRule = (rule, checked) => {
  const selectedRules = new Set(cacheValidStatusRules.value);
  if (checked) {
    selectedRules.add(rule);
  } else {
    selectedRules.delete(rule);
  }

  cacheValidStatusRules.value = cacheStatusRuleOptions
    .map((option) => option.value)
    .filter((value) => selectedRules.has(value));
};

const applySettings = (data) => {
  targetUrl.value = data.targetUrl || "";
  accessToken.value = data.accessToken || "";
  cacheEnabled.value = Boolean(data.cacheEnabled);
  cacheTtlSeconds.value = normalizeCacheTtlSeconds(data.cacheTtlSeconds);
  cacheValidStatusRules.value = normalizeCacheValidStatusRules(data.cacheValidStatusRules);
  lastCacheUpdatedAt.value = normalizeCacheTimestamp(data.cacheLastUpdatedAt);
  hideStatus();
};

const setAuthenticated = (value) => {
  authenticated.value = value;

  if (!value) {
    targetUrl.value = "";
    accessToken.value = "";
    cacheEnabled.value = false;
    cacheTtlSeconds.value = DEFAULT_CACHE_TTL_SECONDS;
    cacheValidStatusRules.value = [];
    lastCacheUpdatedAt.value = null;
    adminKey.value = "";
  }
};

const formatCacheTimestamp = (value) => {
  if (!value) {
    return t("admin.noCacheYet");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t("admin.noCacheYet");
  }

  return new Intl.DateTimeFormat(locale.value === "zh" ? "zh-CN" : "en", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(date);
};

const handleUnauthorized = (message) => {
  setAuthenticated(false);
  setStatus(message, true);
};

const authenticate = async () => {
  busy.value = true;
  setStatus(t("admin.verifyingAdminKey"));

  try {
    const key = requireAdminKey();
    if (!key) {
      return;
    }

    const response = await fetch("/admin/login", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ token: key })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(resolveMessage(data.error, "admin.adminKeyFailed"));
    }

    setAuthenticated(true);
    applySettings(data);
  } catch (error) {
    handleUnauthorized(error instanceof Error ? error.message : t("admin.adminKeyFailed"));
  } finally {
    busy.value = false;
  }
};

const syncLatestTarget = async () => {
  busy.value = true;
  setStatus(t("admin.syncingLatestTarget"));

  try {
    const response = await fetch("/admin/target", {
      method: "GET",
      credentials: "same-origin"
    });
    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401) {
        handleUnauthorized(resolveMessage(data.error, "admin.adminKeyExpired"));
        return;
      }

      throw new Error(resolveMessage(data.error, "admin.readFailed"));
    }

    targetUrl.value = data.targetUrl || "";
    hideStatus();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : t("admin.readFailed"), true);
  } finally {
    busy.value = false;
  }
};

const saveSettings = async () => {
  const nextTargetUrl = targetUrl.value.trim();
  const nextAccessToken = accessToken.value.trim();
  const nextCacheTtlSeconds = Number(cacheTtlSeconds.value);
  if (!nextTargetUrl) {
    showToast(t("admin.enterTargetUrl"), true);
    return;
  }

  if (!nextAccessToken) {
    showToast(t("admin.enterAccessToken"), true);
    return;
  }

  if (!Number.isInteger(nextCacheTtlSeconds) || nextCacheTtlSeconds < 1) {
    showToast(t("admin.invalidCacheTtl"), true);
    return;
  }

  busy.value = true;
  setStatus(t("admin.saving"));

  try {
    const response = await fetch("/admin/settings", {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        targetUrl: nextTargetUrl,
        accessToken: nextAccessToken,
        cacheEnabled: cacheEnabled.value,
        cacheTtlSeconds: nextCacheTtlSeconds,
        cacheValidStatusRules: cacheValidStatusRules.value
      })
    });
    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401) {
        handleUnauthorized(resolveMessage(data.error, "admin.adminKeyExpired"));
        return;
      }

      throw new Error(resolveMessage(data.error, "admin.saveFailed"));
    }

    applySettings(data);
    showToast(t("admin.saved"));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : t("admin.saveFailed"), true);
  } finally {
    busy.value = false;
  }
};

const clearCache = async () => {
  busy.value = true;
  setStatus(t("admin.clearingCache"));

  try {
    const response = await fetch("/admin/cache/clear", {
      method: "POST",
      credentials: "same-origin"
    });
    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401) {
        handleUnauthorized(resolveMessage(data.error, "admin.adminKeyExpired"));
        return;
      }

      throw new Error(resolveMessage(data.error, "admin.clearCacheFailed"));
    }

    lastCacheUpdatedAt.value = normalizeCacheTimestamp(data.cacheLastUpdatedAt);
    hideStatus();
    showToast(t("admin.cacheCleared"));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : t("admin.clearCacheFailed"), true);
  } finally {
    busy.value = false;
  }
};

const logout = async () => {
  if (typeof window !== "undefined" && !window.confirm(t("admin.logoutConfirm"))) {
    return;
  }

  busy.value = true;

  try {
    const response = await fetch("/admin/logout", {
      method: "POST",
      credentials: "same-origin"
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(resolveMessage(data.error, "admin.logoutFailed"));
    }

    hideStatus();
    setAuthenticated(false);
    showToast(t("admin.loggedOut"));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : t("admin.logoutFailed"), true);
  } finally {
    busy.value = false;
  }
};

const bootstrap = async () => {
  busy.value = true;

  try {
    const response = await fetch("/admin/bootstrap", {
      method: "GET",
      credentials: "same-origin"
    });
    const data = await response.json();

    if (response.ok && data.authenticated) {
      setAuthenticated(true);
      applySettings(data);
      return;
    }

    setAuthenticated(false);
    hideStatus();
  } catch {
    setAuthenticated(false);
    hideStatus();
  } finally {
    busy.value = false;
  }
};

const regenerateAccessToken = () => {
  accessToken.value = generateAccessToken();
};

const handleSystemThemeChange = () => {
  if (themeMode.value === "system") {
    applyTheme();
  }
};

const handleDocumentClick = (event) => {
  if (!compactMenu.value || !(event.target instanceof Node)) {
    return;
  }

  if (!compactMenu.value.contains(event.target)) {
    closeCompactMenu();
  }
};

watch(locale, (nextLocale) => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(localeStorageKey, nextLocale);
  }

  applyDocumentLanguage();
});

watch(themeMode, (nextThemeMode) => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(themeStorageKey, nextThemeMode);
  }

  applyTheme();
});

onBeforeUnmount(() => {
  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  if (typeof document !== "undefined") {
    document.removeEventListener("click", handleDocumentClick);
  }

  if (!systemThemeMediaQuery) {
    return;
  }

  if (typeof systemThemeMediaQuery.removeEventListener === "function") {
    systemThemeMediaQuery.removeEventListener("change", handleSystemThemeChange);
    return;
  }

  if (typeof systemThemeMediaQuery.removeListener === "function") {
    systemThemeMediaQuery.removeListener(handleSystemThemeChange);
  }
});

onMounted(() => {
  if (typeof document !== "undefined") {
    document.addEventListener("click", handleDocumentClick);
  }

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    systemThemeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    if (typeof systemThemeMediaQuery.addEventListener === "function") {
      systemThemeMediaQuery.addEventListener("change", handleSystemThemeChange);
    } else if (typeof systemThemeMediaQuery.addListener === "function") {
      systemThemeMediaQuery.addListener(handleSystemThemeChange);
    }
  }

  applyTheme();
  applyDocumentLanguage();
  bootstrap();
});
</script>

<template>
  <main class="shell">
    <section class="hero">
      <div class="hero-head">
        <div>
          <span class="eyebrow">pipink</span>
          <h1>{{ t("admin.heading") }}</h1>
        </div>

        <div class="hero-actions">
          <div class="hero-preferences hero-preferences-inline">
            <div class="theme-switch" :aria-label="t('admin.themeLabel')">
              <button
                v-for="option in availableThemeModes"
                :key="option.code"
                class="theme-button"
                :class="{ active: themeMode === option.code }"
                type="button"
                :aria-label="t(option.labelKey)"
                :title="t(option.labelKey)"
                :aria-pressed="themeMode === option.code"
                @click="setThemeMode(option.code)"
              >
                <svg v-if="option.code === 'system'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="12" rx="2" />
                  <path d="M8 20h8" />
                  <path d="M12 16v4" />
                </svg>
                <svg v-else-if="option.code === 'light'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2" />
                  <path d="M12 20v2" />
                  <path d="M4.93 4.93l1.41 1.41" />
                  <path d="M17.66 17.66l1.41 1.41" />
                  <path d="M2 12h2" />
                  <path d="M20 12h2" />
                  <path d="M4.93 19.07l1.41-1.41" />
                  <path d="M17.66 6.34l1.41-1.41" />
                </svg>
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3c0 5.12 4.15 9.29 9.29 9.79z" />
                </svg>
              </button>
            </div>

            <div class="language-switch" :aria-label="t('admin.languageLabel')">
              <button
                v-for="option in availableLocales"
                :key="option.code"
                class="language-button"
                :class="{ active: locale === option.code }"
                type="button"
                :disabled="busy && locale === option.code"
                @click="setLocale(option.code)"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <details ref="compactMenu" class="hero-preferences-menu">
            <summary class="hero-menu-trigger" :aria-label="t('admin.moreOptions')" :title="t('admin.moreOptions')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="5" cy="12" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="19" cy="12" r="1.5" />
              </svg>
            </summary>

            <div class="hero-menu-panel">
              <label class="hero-menu-field">
                <span>{{ t("admin.themeLabel") }}</span>
                <select :value="themeMode" @change="setThemeMode($event.target.value)">
                  <option v-for="option in availableThemeModes" :key="option.code" :value="option.code">
                    {{ t(option.labelKey) }}
                  </option>
                </select>
              </label>

              <label class="hero-menu-field">
                <span>{{ t("admin.languageLabel") }}</span>
                <select :value="locale" @change="setLocale($event.target.value)">
                  <option v-for="option in availableLocales" :key="option.code" :value="option.code">
                    {{ option.label }}
                  </option>
                </select>
              </label>
            </div>
          </details>

          <button v-if="authenticated" class="danger" type="button" :disabled="busy" @click="logout">
            {{ t("admin.logout") }}
          </button>
        </div>
      </div>
    </section>

    <section class="content">
      <div class="grid">
        <div v-if="!authenticated" class="card">
          <label>
            {{ t("admin.adminKeyLabel") }}
            <input v-model="adminKey" type="password" :placeholder="t('admin.adminKeyPlaceholder')" autocomplete="off" :disabled="busy" />
          </label>

          <div class="actions">
            <button class="primary" type="button" :disabled="busy" @click="authenticate">{{ t("admin.authenticate") }}</button>
          </div>
        </div>

        <div v-if="!authenticated" class="card meta">
          <div>{{ t("admin.dailyUsagePrefix") }} <strong>?token=your-access-token</strong>.</div>
        </div>

        <div v-if="authenticated" class="settings-toolbar">
          <div class="settings-tabs" role="tablist" :aria-label="t('admin.settingsTabsLabel')">
            <button
              v-for="tab in settingsTabs"
              :key="tab.code"
              class="settings-tab"
              :class="{ active: activeSettingsTab === tab.code }"
              type="button"
              role="tab"
              :aria-selected="activeSettingsTab === tab.code"
              @click="setActiveSettingsTab(tab.code)"
            >
              {{ t(tab.labelKey) }}
            </button>
          </div>

          <div class="module-actions">
            <button class="primary" type="button" :disabled="busy" @click="saveSettings">{{ t("admin.save") }}</button>
          </div>
        </div>

        <div v-if="authenticated" class="card manage-card">

          <section v-if="activeSettingsTab === 'basic'" class="settings-panel">
            <label>
              <div class="field-head">
                <span>{{ t("admin.targetUrlLabel") }}</span>
                <button class="secondary action-button" type="button" :disabled="busy" :aria-label="t('admin.syncLatestTarget')" :title="t('admin.syncLatestTarget')" @click="syncLatestTarget">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 3v11" />
                    <path d="M7 10l5 5 5-5" />
                    <path d="M5 21h14" />
                  </svg>
                  <span>{{ t("admin.syncLatestTarget") }}</span>
                </button>
              </div>
              <textarea v-model="targetUrl" placeholder="https://example.com/your-real-link"></textarea>
            </label>

            <label>
              <div class="field-head">
                <span>{{ t("admin.accessTokenLabel") }}</span>
                <button class="secondary action-button" type="button" :disabled="busy" :aria-label="t('admin.regenerateAccessToken')" :title="t('admin.regenerateAccessToken')" @click="regenerateAccessToken">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                    <path d="M21 3v6h-6" />
                  </svg>
                  <span>{{ t("admin.regenerateAccessToken") }}</span>
                </button>
              </div>
              <input v-model="accessToken" type="text" :placeholder="t('admin.accessTokenPlaceholder')" autocomplete="off" :disabled="busy" />
            </label>
          </section>

          <section v-else class="settings-panel cache-settings">
            <label class="cache-field">
              <div class="cache-copy">
                <div class="field-head">
                  <span>{{ t("admin.cacheEnabledLabel") }}</span>

                  <label class="switch-control">
                    <input v-model="cacheEnabled" class="switch-input" type="checkbox" :disabled="busy" />
                    <span class="switch-track" aria-hidden="true">
                      <span class="switch-thumb"></span>
                    </span>
                  </label>
                </div>

                <div class="cache-note">
                  <p class="field-note">{{ t("admin.cacheEnabledHint") }}</p>
                </div>
              </div>
            </label>

            <template v-if="cacheEnabled">
              <label class="cache-field">
                <div class="field-head">
                  <span>{{ t("admin.cacheTtlLabel") }}</span>
                </div>
                <input v-model.number="cacheTtlSeconds" type="number" min="1" step="1" :disabled="busy" />
              </label>

              <div class="cache-meta">
                <p class="field-note cache-meta-text">
                  {{ t("admin.cacheLastUpdatedLabel") }}{{ formatCacheTimestamp(lastCacheUpdatedAt) }}
                </p>

                <button
                  v-if="lastCacheUpdatedAt"
                  class="secondary icon-button"
                  type="button"
                  :disabled="busy"
                  :aria-label="t('admin.clearCache')"
                  :title="t('admin.clearCache')"
                  @click="clearCache"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M19 6l-1 14H6L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                  </svg>
                </button>
              </div>

              <div class="cache-field cache-status-rules">
                <div class="field-head">
                  <span>{{ t("admin.cacheValidStatusLabel") }}</span>
                </div>

                <div class="cache-note subtle">
                  <p class="field-note">{{ t("admin.cacheValidStatusHelp") }}</p>
                </div>

                <div class="status-rule-grid">
                  <label v-for="option in cacheStatusRuleOptions" :key="option.value" class="status-rule-option">
                    <input
                      class="status-rule-checkbox"
                      type="checkbox"
                      :checked="cacheValidStatusRules.includes(option.value)"
                      :disabled="busy"
                      @change="setCacheStatusRule(option.value, $event.target.checked)"
                    />
                    <span>{{ option.label }}</span>
                  </label>
                </div>
              </div>
            </template>
          </section>

        </div>

        <div class="status" :class="{ visible: statusVisible, error: statusError }">{{ statusMessage }}</div>
      </div>
    </section>
  </main>

  <div class="toast" :class="{ hidden: !toastVisible, visible: toastVisible, error: toastError }">{{ toastMessage }}</div>
</template>