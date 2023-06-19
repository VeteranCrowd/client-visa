// npm imports
import axios from 'axios';
import fs from 'fs-extra';
import createError from 'http-errors';
import https from 'https';
import _ from 'lodash';
import { nanoid } from 'nanoid';
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
   * Make a request to the Visa API.
   * @private
   * @param {object} config - Request config.
   * @param {string} [operationId] - OpenAPI operationId.
   * @return {object} - The response data or error object.
   */
  async #request(config, operationId) {
    const requestConfig = _.assign(_.cloneDeep(this.#axiosConfig), config);

    this.#logger.debug(
      '*** AXIOS REQUEST CONFIG ***',
      _.pick(requestConfig, [
        'baseURL',
        'url',
        'method',
        'headers',
        'params',
        'data',
      ]),
      'operationId',
      operationId
    );

    // OpenAPI request.
    let response;
    if (operationId) {
      if (!client[operationId])
        throw new Error(`Invalid operationId: ${operationId}`);
      response = await client[operationId](undefined, undefined, requestConfig);
    } else response = await axios.request(requestConfig);

    this.#logger.debug('*** AXIOS REQUEST RESPONSE ***', response.data);

    // Handle errors.
    if (response.status >= 400) {
      this.#logger.error([
        '*** AXIOS REQUEST CONFIG ***',
        requestConfig,
        'operationId',
        operationId,
        '*** AXIOS REQUEST RESPONSE ***',
        response,
      ]);

      const { data, status, statusText } = response;
      throw new createError(
        status,
        JSON.stringify({ status, statusText, data })
      );
    }

    return response.data;
  }

  /**
   * Send a POST request to the Add Card endpoint.
   * @param {string} userKey - External user ID.
   * @param {object} cardInfo - Card info.
   * @return {object} - The response data or error object.
   */
  async addCard(userKey, cardInfo) {
    return await this.#request(
      {
        data: {
          card: cardInfo,
          communityCode: this.#communityCode,
          communityTermsVersion: '1',
          correlationId: nanoid(),
          userKey: userKey,
        },
      },
      'Users_Addcard'
    );
  }

  /**
   * Send a POST request to the Delete Card endpoint.
   * @param {string} userKey - External user id.
   * @param {object} cardId - Card id.
   * @return {object} - The response data or error object.
   */
  async deleteCard(userKey, cardId) {
    return await this.#request(
      {
        data: {
          card: { cardId },
          communityCode: this.#communityCode,
          communityTermsVersion: '1',
          correlationId: nanoid(),
          userKey: userKey,
        },
      },
      'Users_DeleteCard'
    );
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
    return await this.#request({ method: 'get', url: 'vdp/helloworld' });
  }

  /**
   * Send a POST request to the Enroll User endpoint.
   * @param {string} userKey - External user ID.
   * @param {object} cardInfo - Card info.
   * @return {object} - The response data or error object.
   */
  async enrollUser(userKey, cardInfo) {
    return await this.#request(
      {
        data: {
          correlationId: nanoid(),
          communityTermsVersion: '1',
          userDetails: {
            cards: [cardInfo],
            communityCode: this.#communityCode,
            externalUserId: userKey,
            userKey: userKey,
          },
        },
      },
      'Users_Enroll'
    );
  }

  /**
   * Send a POST request to the Get User endpoint.
   * @param {string} userKey - External user ID.
   * @return {object} - The response data or error object.
   */
  async getUser(userKey) {
    return await this.#request(
      {
        data: {
          communityCode: this.#communityCode,
          communityTermsVersion: '1',
          correlationId: nanoid(),
          userKey: userKey,
        },
      },
      'Users_GetUserEnrollmentRecord'
    );
  }

  /**
   * Send a POST request to the Unenroll User endpoint.
   * @param {string} userKey - External user ID.
   * @return {object} - The response data or error object.
   */
  async unenrollUser(userKey) {
    return await this.#request(
      {
        data: {
          communityCode: this.#communityCode,
          communityTermsVersion: '1',
          correlationId: nanoid(),
          userKey: userKey,
        },
      },
      'Users_UnEnroll'
    );
  }
}
