/*
******************* DO NOT EDIT THIS NOTICE *****************
This code and all related intellectual property is owned by
Veteran Crowd Rewards, LLC. It is not to be disclosed, copied
or used without written permission.
*************************************************************
*/

// npm imports
import axios from "axios";
import fs from "fs-extra";
import createError from "http-errors";
import https from "https";
import _ from "lodash";
import { nanoid } from "nanoid";
import jose from "node-jose";
import { OpenAPIClientAxios } from "openapi-client-axios";
import path from "path";
import { URL, fileURLToPath } from "url";

// Logging interceptors.
const logRequest = (logger) => (request) => {
  logger.debug(`***AXIOS REQUEST ***`, {
    url: request.url,
    method: request.method,
    query: request.params,
    data: request.data,
  });
  return request;
};

axios.interceptors.request.use(logRequest(console));

const logResponse = (logger) => (response) => {
  logger[response.status < 400 ? "debug" : "error"]("*** AXIOS RESPONSE ***", {
    status: response.status,
    headers: response.headers,
    data: response.data,
  });
  return response;
};

axios.interceptors.response.use(logResponse(console));

// Import CA certificate.
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ca = await fs.readFile(
  path.resolve(__dirname, "../lib/DigiCertGlobalRootCA.crt"),
);

export class VisaClient {
  #axiosConfig;
  #axiosConfigProd;
  #client;
  #clientProd;
  #communityCode;
  #communityCodeProd;
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
   * @typedef {object} MerchantDetailsResponse
   * @property {MerchantDetail[]} merchantDetails
   * @property {number} numberOfMatchedRecords
   * @property {string} correlationId
   * @property {string} responseDateTime
   * @property {ResponseStatus} responseStatus
   */

  /**
   * @typedef {object} MerchantDetail
   * @property {string} visaMerchantId
   * @property {string} visaMerchantName
   * @property {string|undefined} visaMerchantEnterpriseName
   * @property {string|undefined} visaStoreId
   * @property {string|undefined} visaStoreName
   * @property {string[]|undefined} merchantCategoryCode
   * @property {string[]} merchantPhoneNumber
   * @property {string|undefined} merchantCountryCode
   * @property {string|undefined} merchantCity
   * @property {string|undefined} merchantState
   * @property {string|undefined} merchantPostalCode
   * @property {string|undefined} merchantStreetAddress
   * @property {string[]|undefined} merchantUrl
   * @property {string[]|undefined} DBAName
   * @property {string[]|undefined} paymentFacilitatorName
   * @property {string[]} matchIndicators
   * @property {string|undefined} qualityIndex
   * @property {string|undefined} lastTranDateRange
   * @property {string|undefined} firstTranDateRange
   * @property {string[]|undefined} businessLegalName
   * @property {string[]|undefined} terminalType
   * @property {string[]|undefined} paymentAcceptanceMethod
   * @property {string[]|undefined} merchantCategoryCodeDesc
   */

  /**
   * @typedef {object} ResponseStatus
   * @property {string} code
   * @property {string} message
   */

  /**
   * Create a new VisaClient.
   * @param {VisaClientConfig} config - VisaClient configuration.
   * @param {VisaClientConfig} [prodConfig] - Optional VisaClient Production configuration.
   * @return {VisaClient} - A new VisaClient.
   */
  constructor(config = {}, prodConfig) {
    // Validate config.
    if (!config.baseUrl) throw new Error("baseUrl is required");
    if (!config.clientCert) throw new Error("clientCert is required");
    if (!config.clientKey) throw new Error("clientKey is required");
    if (!config.communityCode) throw new Error("communityCode is required");
    if (!config.passphrase) throw new Error("passphrase is required");
    if (!config.userId) throw new Error("userId is required");

    if (!_.isNil(prodConfig)) {
      if (prodConfig && !_.isObject(prodConfig)) {
        throw new Error("prodConfig must be an object");
      }

      if (prodConfig) {
        if (!prodConfig.baseUrl) {
          throw new Error("prodConfig.baseUrl is required");
        }
        if (!prodConfig.clientCert) {
          throw new Error("prodConfig.clientCert is required");
        }
        if (!prodConfig.clientKey) {
          throw new Error("prodConfig.clientKey is required");
        }
        if (!prodConfig.communityCode) {
          throw new Error("prodConfig.communityCode is required");
        }
        if (!prodConfig.passphrase) {
          throw new Error("prodConfig.passphrase is required");
        }
        if (!prodConfig.userId) {
          throw new Error("prodConfig.userId is required");
        }
      }
    }

    // Init axios config.
    this.#axiosConfig = {
      auth: {
        username: config.userId,
        password: config.passphrase,
      },
      baseURL: config.baseUrl,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
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

    if (prodConfig) {
      this.#axiosConfigProd = {
        auth: {
          username: prodConfig.userId,
          password: prodConfig.passphrase,
        },
        baseURL: prodConfig.baseUrl,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        httpsAgent: new https.Agent({
          ca,
          cert: prodConfig.clientCert,
          key: prodConfig.clientKey,
          passphrase: prodConfig.passphrase,
          rejectUnauthorized: false,
        }),
        validateStatus: null,
      };
    }

    // Init instance config.
    this.#communityCode = config.communityCode;
    this.#communityCodeProd = prodConfig?.communityCode;
    this.#logger = config.logger ?? console;

    return this;
  }

  /**
   * Apply message-level encoding to a data object.
   * @private
   * @param {object} data - The data object to encode.
   * @return {Promise<string>} - The encoded data object.
   */
  async #encodeMessage(data) {
    return (
      await jose.JWE.createEncrypt(
        {
          format: "compact",
          contentAlg: "A128GCM",
          fields: { iat: Date.now() },
        },
        this.#mleKey,
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
   * @return {Promise<object>} - The response data or error object.
   */
  async #request(config, operationId) {
    const requestConfig = _.assign(_.cloneDeep(this.#axiosConfig), config);

    // this.#logger.debug(
    //   '*** AXIOS REQUEST CONFIG ***',
    //   _.pick(requestConfig, [
    //     'baseURL',
    //     'url',
    //     'method',
    //     'headers',
    //     'params',
    //     'data',
    //   ]),
    //   'operationId',
    //   operationId
    // );

    // OpenAPI request.
    let response;
    if (operationId) {
      if (!this.#client[operationId])
        throw new Error(`Invalid operationId: ${operationId}`);
      response = await this.#client[operationId](
        undefined,
        undefined,
        requestConfig,
      );
    } else response = await axios.request(requestConfig);

    // this.#logger.debug('*** AXIOS REQUEST RESPONSE ***', response.data);

    // Handle errors.
    if (response.status >= 400) {
      // this.#logger.error([
      //   '*** AXIOS REQUEST CONFIG ***',
      //   requestConfig,
      //   'operationId',
      //   operationId,
      //   '*** AXIOS REQUEST RESPONSE ***',
      //   response,
      // ]);

      const { data, status, statusText } = response;
      throw new createError(
        status,
        JSON.stringify({ status, statusText, data }),
      );
    }

    return response.data;
  }

  /**
   * Send a POST request to the Add Card endpoint.
   * @param {string} userKey - External user ID.
   * @param {object} cardInfo - Card info.
   * @return {Promise<object>} - The response data or error object.
   */
  async addCard(userKey, cardInfo) {
    const data = {
      card: cardInfo,
      communityCode: this.#communityCode,
      communityTermsVersion: "1",
      correlationId: nanoid(),
      userKey: userKey,
    };

    return await this.#request(
      {
        data: this.#mleKey
          ? { encData: await this.#encodeMessage(data) }
          : data,
      },
      "Users_Addcard",
    );
  }

  /**
   * Send a POST request to the Delete Card endpoint.
   * @param {string} userKey - External user id.
   * @param {object} cardId - Card id.
   * @return {Promise<object>} - The response data or error object.
   */
  async deleteCard(userKey, cardId) {
    return await this.#request(
      {
        data: {
          card: { cardId },
          communityCode: this.#communityCode,
          communityTermsVersion: "1",
          correlationId: nanoid(),
          userKey: userKey,
        },
      },
      "Users_DeleteCard",
    );
  }

  /**
   * Initialize Message Level Encryption.
   * @param {string} openapi - Visa OpenAPI spec.
   * @param {string} [keyId] - The MLE keyId.
   * @param {string} [serverKey] - The MLE server key in PEM format.
   * @return {Promise<string>} - The Visa Client instance.
   */
  async init(openapi, keyId, serverKey) {
    if (!openapi) throw new Error("openapi is required");
    this.#client = await new OpenAPIClientAxios({
      definition: openapi,
    }).getClient();

    this.#client.interceptors.request.use(logRequest(this.#logger));
    this.#client.interceptors.response.use(logResponse(this.#logger));

    if (this.#axiosConfigProd) {
      this.#clientProd = await new OpenAPIClientAxios({
        definition: openapi,
      }).getClient();

      this.#clientProd.interceptors.request.use(logRequest(this.#logger));
      this.#clientProd.interceptors.response.use(logResponse(this.#logger));
    }

    if ((!keyId && serverKey) || (keyId && !serverKey))
      throw new Error("keyId and serverKey must be specified together");

    if (keyId)
      this.#mleKey = await jose.JWK.asKey(serverKey, "PEM", {
        kty: "RSA",
        alg: "RSA-OAEP-256",
        kid: keyId,
        enc: "A128GCM",
        key_opts: ["wrapKey", "enc"],
      });

    return this;
  }

  /**
   * Send a GET request to the Hello World endpoint.
   * @return {Promise} - The response data or error object.
   */
  async helloWorld() {
    return await this.#request({ method: "get", url: "vdp/helloworld" });
  }

  /**
   * Send a POST request to the Enroll User endpoint.
   * @param {string} userKey - External user ID.
   * @param {object} cardInfo - Card info.
   * @param {object} [promoCode] - Promo code.
   * @return {Promise<object>} - The response data or error object.
   */
  async enrollUser(userKey, cardInfo, promoCode) {
    const data = {
      correlationId: nanoid(),
      communityTermsVersion: "1",
      userDetails: {
        cards: [cardInfo],
        communityCode: this.#communityCode,
        externalUserId: userKey,
        ...(promoCode ? { promoCode } : {}),
        userKey: userKey,
      },
    };

    return await this.#request(
      {
        data: this.#mleKey
          ? { encData: await this.#encodeMessage(data) }
          : data,
      },
      "Users_Enroll",
    );
  }

  /**
   * Send a POST request to the Get User endpoint.
   * @param {string} userKey - External user ID.
   * @return {Promise<object>} - The response data or error object.
   */
  async getUser(userKey) {
    return await this.#request(
      {
        data: {
          communityCode: this.#communityCode,
          communityTermsVersion: "1",
          correlationId: nanoid(),
          userKey: userKey,
        },
      },
      "Users_GetUserEnrollmentRecord",
    );
  }

  /**
   * Send a POST request to the Unenroll User endpoint.
   * @param {string} userKey - External user ID.
   * @return {Promise<object>} - The response data or error object.
   */
  async unenrollUser(userKey) {
    return await this.#request(
      {
        data: {
          communityCode: this.#communityCode,
          communityTermsVersion: "1",
          correlationId: nanoid(),
          userKey: userKey,
        },
      },
      "Users_UnEnroll",
    );
  }

  // Prod only region

  /**
   * Make a request to the Production Visa API.
   * @private
   * @param {object} config - Request config.
   * @param {string} [operationId] - OpenAPI operationId.
   * @return {Promise<object>} - The response data or error object.
   */
  async #prodRequest(config, operationId) {
    const requestConfig = _.assign(_.cloneDeep(this.#axiosConfigProd), config);

    // OpenAPI request.
    let response;
    if (operationId) {
      if (!this.#client[operationId])
        throw new Error(`Invalid operationId: ${operationId}`);
      response = await this.#clientProd[operationId](
        undefined,
        undefined,
        requestConfig,
      );
    } else response = await axios.request(requestConfig);

    if (response.status >= 400) {
      const { data, status, statusText } = response;
      throw new createError(
        status,
        JSON.stringify({ status, statusText, data }),
      );
    }

    return response.data;
  }

  /**
   * Send a GET request to the Merchant Search endpoint.
   * @param {string} merchantId - Merchant ID.
   * @param {string} storeId - Store ID.
   * @param {string} name - Merchant name.
   * @return {Promise<MerchantDetailsResponse>} - The response data or error object.
   */
  async merchantSearch({ merchantId, storeId, name }) {
    const req = {
      params: {
        communityCode: this.#communityCodeProd,
        merchantId,
        merchantName: name,
        merchantSearchType: !!merchantId || !!storeId ? "Exact" : "Relative",
        storeId,
      },
    };

    if (this.#clientProd) {
      return await this.#prodRequest(req, "Merchants_GetMerchantSearchDetails");
    }

    return await this.#request(req, "Merchants_GetMerchantSearchDetails");
  }

  // endregion
}
