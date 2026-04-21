<script setup>
import { onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { availableLocales, localeStorageKey } from "./i18n";

const { t, locale } = useI18n();

const apiErrorKeys = {
  "Unauthorized": "apiErrors.unauthorized",
  "Invalid JSON body": "apiErrors.invalidJsonBody",
  "targetUrl must be a valid http or https URL": "apiErrors.invalidTargetUrl",
  "accessToken must be a non-empty string": "apiErrors.invalidAccessToken",
  "Method Not Allowed": "apiErrors.methodNotAllowed",
  "Access token is not configured": "apiErrors.accessTokenNotConfigured",
  "Target URL is not configured": "apiErrors.targetUrlNotConfigured"
};

const adminKey = ref("");
const targetUrl = ref("");
const accessToken = ref("");
const authenticated = ref(false);
const busy = ref(false);
const statusMessage = ref("");
const statusError = ref(false);
const statusVisible = ref(false);
const toastMessage = ref("");
const toastVisible = ref(false);

let toastTimer = null;

const resolveMessage = (message, fallbackKey) => {
  const key = apiErrorKeys[message];
  return key ? t(key) : message || t(fallbackKey);
};

const applyDocumentLanguage = () => {
  document.documentElement.lang = locale.value === "zh" ? "zh-CN" : "en";
  document.title = t("admin.documentTitle");
};

const setLocale = (nextLocale) => {
  locale.value = nextLocale;
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

const showToast = (message) => {
  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastMessage.value = message;
  toastVisible.value = true;

  toastTimer = setTimeout(() => {
    toastVisible.value = false;
  }, 2200);
};

const requireAdminKey = () => {
  const value = adminKey.value.trim();
  if (!value) {
    throw new Error(t("admin.enterAdminKey"));
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

const applySettings = (data) => {
  targetUrl.value = data.targetUrl || "";
  accessToken.value = data.accessToken || "";
  hideStatus();
};

const setAuthenticated = (value) => {
  authenticated.value = value;

  if (!value) {
    targetUrl.value = "";
    accessToken.value = "";
    adminKey.value = "";
  }
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
  if (!nextTargetUrl) {
    setStatus(t("admin.enterTargetUrl"), true);
    return;
  }

  if (!nextAccessToken) {
    setStatus(t("admin.enterAccessToken"), true);
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
      body: JSON.stringify({ targetUrl: nextTargetUrl, accessToken: nextAccessToken })
    });
    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401) {
        handleUnauthorized(resolveMessage(data.error, "admin.adminKeyExpired"));
        return;
      }

      throw new Error(resolveMessage(data.error, "admin.saveFailed"));
    }

    accessToken.value = data.accessToken || nextAccessToken;
    hideStatus();
    showToast(t("admin.saved"));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : t("admin.saveFailed"), true);
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

watch(locale, (nextLocale) => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(localeStorageKey, nextLocale);
  }

  applyDocumentLanguage();
});

onMounted(() => {
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

        <div v-if="authenticated" class="card manage-card">
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

          <div class="actions">
            <button class="primary" type="button" :disabled="busy" @click="saveSettings">{{ t("admin.save") }}</button>
          </div>
        </div>

        <div class="status" :class="{ visible: statusVisible, error: statusError }">{{ statusMessage }}</div>
      </div>
    </section>
  </main>

  <div class="toast" :class="{ hidden: !toastVisible, visible: toastVisible }">{{ toastMessage }}</div>
</template>