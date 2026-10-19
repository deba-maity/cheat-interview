"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PROVIDERS, DEFAULT_ORDER, list, boundedNumber, fromEnvironment } = require("./providers");

function validateBaseURL(value) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error("API URLs must use HTTPS, or HTTP on localhost, without credentials or query parameters.");
  }
  return url.toString().replace(/\/$/, "");
}

class ConfigStore {
  constructor({ directory, encryption, env = process.env, keySource={} } = {}) {
    this.env = env;
    this.keySource=keySource;
    this.encryption = encryption;
    this.file = directory ? path.join(directory, "provider-settings.enc") : null;
    this.saved = {};
    this.loadError = null;
    if (this.file && fs.existsSync(this.file)) {
      try {
        if (!encryption?.isEncryptionAvailable()) throw new Error("Encryption is unavailable.");
        this.saved = JSON.parse(encryption.decryptString(fs.readFileSync(this.file)));
      } catch {
        this.loadError = "Saved provider settings could not be unlocked. Environment keys still work; save your settings again to repair the file.";
      }
    }
  }

  get() {
    const config = fromEnvironment(this.env);
    for (const id of DEFAULT_ORDER) {
      config.providers[id] = { ...config.providers[id], ...this.saved.providers?.[id] };
      if (this.keySource.sources?.[id]==="file") {
        const prefix=id.toUpperCase();
        config.providers[id].keys=list(this.env[`${prefix}_API_KEYS`]||this.env[`${prefix}_API_KEY`]);
      }
    }
    for (const field of ["order", "timeoutMs", "budgetMs", "maxAttempts"]) {
      if (this.saved[field] !== undefined) config[field] = this.saved[field];
    }
    return config;
  }

  public() {
    const config = this.get();
    return {
      order: config.order, timeoutMs: config.timeoutMs, budgetMs: config.budgetMs,
      maxAttempts: config.maxAttempts, loadError: this.loadError,
      encryptedStorage: Boolean(this.encryption?.isEncryptionAvailable()),
      keyFileLoaded: Boolean(this.keySource.file),keyFileError:this.keySource.error||null,
      providers: Object.fromEntries(Object.entries(config.providers).map(([id, provider]) => [id, {
        label: provider.label, baseURL: provider.baseURL, keyCount: provider.keys.length,
        keySource:this.keySource.sources?.[id]==="file"?"file":this.saved.providers?.[id]?.keys!==undefined?"saved":"environment",
        textModels: provider.textModels, visionModels: provider.visionModels,
        transcriptionModels: provider.transcriptionModels,
      }])),
    };
  }

  reloadKeys(source) {
    this.env=source.env;this.keySource=source;
    return this.public();
  }

  save(input) {
    if (!this.file || !this.encryption?.isEncryptionAvailable()) {
      throw new Error("Encrypted key storage is unavailable. Configure keys using your local .env file instead.");
    }
    if (!input || typeof input !== "object") throw new Error("Invalid settings.");
    const next = structuredClone(this.saved);
    next.providers ||= {};
    for (const [id, changes] of Object.entries(input.providers || {})) {
      if (!PROVIDERS[id] || !changes || typeof changes !== "object") throw new Error("Unknown provider.");
      const provider = { ...(next.providers[id] || {}) };
      if (changes.clearKeys === true) provider.keys = [];
      else if (changes.keys && list(changes.keys).length) {
        const keys = list(changes.keys);
        if (keys.length > 16 || keys.some(k => k.length > 1024 || /\s/.test(k))) {
          throw new Error("Use up to 16 keys per provider, separated by commas or newlines.");
        }
        provider.keys = keys;
      }
      if (changes.baseURL !== undefined) provider.baseURL = validateBaseURL(changes.baseURL);
      for (const field of ["textModels", "visionModels", "transcriptionModels"]) {
        if (changes[field] !== undefined) {
          const models = list(changes[field]);
          if (models.length > 12 || models.some(m => m.length > 200 || /\s/.test(m))) {
            throw new Error("Use up to 12 model IDs, separated by commas.");
          }
          provider[field] = models;
        }
      }
      next.providers[id] = provider;
    }
    if (input.order !== undefined) {
      const order = list(input.order);
      if (!order.length || order.some(id => !PROVIDERS[id])) throw new Error("Provider order must contain known provider IDs.");
      next.order = order;
    }
    if (input.timeoutMs !== undefined) next.timeoutMs = boundedNumber(input.timeoutMs, 18000, 1000, 60000);
    if (input.budgetMs !== undefined) next.budgetMs = boundedNumber(input.budgetMs, 90000, 5000, 180000);
    if (input.maxAttempts !== undefined) next.maxAttempts = boundedNumber(input.maxAttempts, 12, 1, 30);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, this.encryption.encryptString(JSON.stringify(next)), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
    this.saved = next;
    this.loadError = null;
    return this.public();
  }
}

module.exports = { ConfigStore, validateBaseURL };
