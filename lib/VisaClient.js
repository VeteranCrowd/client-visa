// npm imports
import axios from 'axios';
import fs from 'fs-extra';
import https from 'https';
import jose from 'node-jose';
import { OpenAPIClientAxios } from 'openapi-client-axios';
import path from 'path';
import { URL, fileURLToPath } from 'url';

// Import CA certificate.
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ca = await fs.readFile(
  path.resolve(__dirname, '../lib/DigiCertGlobalRootCA.crt')
);

// Get OpenAPI client.
// Temporary workaround for jsdoc until we can get import assertion parsing to work.
// const definition = {};
import definition from './vop.openapi.json' assert { type: 'json' };
const client = await new OpenAPIClientAxios({ definition }).getClient(); // eslint-disable-line

export class VisaClient {
  #axiosConfig;
  #baseUrl;
  #client;
  #communityCode;
  #logger;
  #mleKey;

  /**
   * Config object for VisaClient.
   * @typedef {object} VisaClientConfig
   * @property {string} baseUrl - Visa API base URL.
   * @property {string} clientCert - Client certificate in PEM format.
   * @property {string} clientKey - Client certificate private key in PEM format.
   * @property {string} communityCode - Visa API community code.
   * @property {object} [logger] - Logger instance (default is {@link https://nodejs.org/api/console.html#class-console global console object}). Must have info, error & debug methods
   * @property {string} passphrase - Visa API passphrase.
   * @property {string} userId - Visa API user ID.
   */

  /**
   * Create a new VisaClient.
   * @param {VisaClientConfig} config - VisaClient configuration.
   * @return {VisaClient} - A new VisaClient.
   */
  constructor(config = {}) {
    // Validate config.
    if (!config.baseUrl) throw new Error('baseUrl is required');
    if (!config.clientCert) throw new Error('clientCert is required');
    if (!config.clientKey) throw new Error('clientKey is required');
    if (!config.communityCode) throw new Error('communityCode is required');
    if (!config.passphrase) throw new Error('passphrase is required');
    if (!config.userId) throw new Error('userId is required');

    // Init axios config.
    this.#axiosConfig = {
      auth: {
        username: config.userId,
        password: config.passphrase,
      },
      baseURL: config.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      httpsAgent: new https.Agent({
        ca,
        cert: config.clientCert,
        key: config.clientKey,
        passphrase: config.passphrase,
        rejectUnauthorized: false,
      }),
      validateStatus: null,
    };

    // Init instance config.
    this.#baseUrl = config.baseUrl;
    this.#communityCode = config.communityCode;
    this.#logger = config.logger ?? console;

    return this;
  }

  /**
   * Apply message-level encoding to a data object.
   * @private
   * @param {object} data - The data object to encode.
   * @return {string} - The encoded data object.
   */
  async #encodeMessage(data) {
    return (
      await jose.JWE.createEncrypt(
        {
          format: 'compact',
          contentAlg: 'A128GCM',
          fields: { iat: Date.now() },
        },
        this.#mleKey
      )
        .update(JSON.stringify(data))
        .final()
    ).toString();
  }

  /**
   * Initialize Message Level Encryption.
   * @param {string} [keyId] - The MLE keyId.
   * @param {string} [serverKey] - The MLE server key in PEM format.
   * @return {string} - The Visa Client instance.
   */
  async initMle(keyId, serverKey) {
    if (!keyId) throw new Error('keyId is required');
    if (!serverKey) throw new Error('keyId is required');

    this.#mleKey = await jose.JWK.asKey(serverKey, 'PEM', {
      kty: 'RSA',
      alg: 'RSA-OAEP-256',
      kid: keyId,
      enc: 'A128GCM',
      key_opts: ['wrapKey', 'enc'],
    });

    return this;
  }

  /**
   * Send a GET request to the Hello World endpoint.
   * @return {object} - The response data or error object.
   */
  async helloWorld() {
    const api = axios.create(this.#axiosConfig);
    return (await api.get('vdp/helloworld')).data;
  }
}
