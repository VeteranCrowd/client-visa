/* eslint-env mocha */

// npm imports
import { Logger } from '@karmaniverous/edge-logger';
import chai, { expect } from 'chai';
import chaiMatchPattern from 'chai-match-pattern';
import generateCardNumber from 'creditcard-generator';
import _ from 'lodash';
import { nanoid } from 'nanoid';
import generateName from 'node-random-name';
import { setTimeout } from 'timers/promises';

chai.use(chaiMatchPattern);

// lib imports
import { VisaClient } from './index.js';
import openapi from '../local/vop.openapi.json' assert { type: 'json' };

const USE_MLE = true;

const generateCardInfo = () => ({
  cardNumber: generateCardNumber.GenCC('VISA')[0],
  cvv2: _.random(999).toString().padStart(3, '0'),
  expirationMonth: _.random(1, 12).toString().padStart(1, '0'),
  expirationYear: (new Date().getFullYear() + _.random(1, 5)).toString(),
  nameOnCard: generateName(),
});

describe('VisaClient', function () {
  let config;
  let visaClient;

  before(async function () {
    config = {
      baseUrl: process.env.VISA_API_BASE_URL,
      clientCert: process.env.VISA_API_CLIENT_CERT,
      clientKey: process.env.VISA_API_PRIVATE_KEY,
      communityCode: process.env.VISA_API_COMMUNITY_CODE,
      logger: new Logger({ maxLevel: process.env.LOG_LEVEL }),
      passphrase: process.env.VISA_API_PASSWORD,
      userId: process.env.VISA_API_USER_ID,
    };

    visaClient = new VisaClient(config);
    await visaClient.init(
      openapi,
      ...(USE_MLE
        ? [process.env.VISA_API_MLE_KEY_ID, process.env.VISA_API_MLE_SERVER_KEY]
        : [])
    );
  });

  describe('constructor', function () {
    it('creates an instance', function () {
      const visaClient = new VisaClient(config);
      expect(visaClient).to.be.an.instanceOf(VisaClient);
    });

    it('throws with no config', function () {
      expect(() => new VisaClient()).to.throw;
    });
  });

  describe('helloWorld', function () {
    it('returns hello world', async function () {
      const response = await visaClient.helloWorld();
      expect(response).to.matchPattern(`{
        message: 'helloworld',
        timestamp: _.isDateString
      }`);
    });
  });

  describe('enrollUser/getUser/unenrollUser', function () {
    describe('validation', function () {
      it('completes cycle', async function () {
        const cardInfo = generateCardInfo();
        const userKey = nanoid();

        // Enroll user.
        const enrollResponse = await visaClient.enrollUser(userKey, cardInfo);
        expect(enrollResponse).to.matchPattern(`{
          responseStatus: {
            code: 'SUCCESS',
            ...
          },
          userDetails: {
            cards: [
              {
                cardId: _.isString,
                cardLast4: /^${cardInfo.cardNumber.slice(-4)}$/,
                cardStatus: 'New',
                ...
              },
            ],
            userKey: '${userKey}',
            ...
          },
          ...
        }`);

        await setTimeout(5000);

        // Get user info.
        const getResponse = await visaClient.getUser(userKey);
        expect(getResponse).to.matchPattern(`{
          enrollmentRecord: {
            cardDetails: [
              {
                CardId: _.isString,
                CardLast4: /^${cardInfo.cardNumber.slice(-4)}$/,
                CardStatus: 'Existing',
                ...
              }
            ],
            cardHolderDetails: {
              externalUserId: '${userKey}',
              ...
            },
            communityCode: '${process.env.VISA_API_COMMUNITY_CODE}',
            userKey: '${userKey}',
            userStatus: 'Active',
            ...
          },
          responseStatus: {
            code: 'SUCCESS',
            ...
          },
          ...
        }`);

        // Unenroll user.
        const unenrollResponse = await visaClient.unenrollUser(userKey);
        expect(unenrollResponse).to.matchPattern(`{
          responseStatus: {
            code: 'SUCCESS',
            ...
          },
          ...
        }`);

        // Get user info.
        expect(async () => await visaClient.getUser(userKey)).to.throw;
      });
    });

    describe('add/delete card', function () {
      let cardInfo;
      let userKey;

      beforeEach(async function () {
        cardInfo = generateCardInfo();
        userKey = nanoid();

        // Enroll user.
        await visaClient.enrollUser(userKey, cardInfo);
      });

      it('completes cycle', async function () {
        // Add card.
        cardInfo = generateCardInfo();
        const addResponse = await visaClient.addCard(userKey, cardInfo);
        expect(addResponse).to.matchPattern(`{
          cardDetails: {
            cardId: _.isString,
            cardLast4: /^${cardInfo.cardNumber.slice(-4)}$/,
            cardStatus: 'New',
            ...
          },
          responseStatus: {
            code: 'SUCCESS',
            ...
          },
          ...
        }`);

        // Get user info.
        const getResponse = await visaClient.getUser(userKey);
        expect(
          getResponse.enrollmentRecord.cardDetails.map(({ CardId }) => CardId)
        ).to.include(addResponse.cardDetails.cardId);

        // Delete card.
        const deleteResponse = await visaClient.deleteCard(
          userKey,
          addResponse.cardDetails.cardId
        );
        expect(deleteResponse).to.matchPattern(`{
          responseStatus: {
            code: 'SUCCESS',
            ...
          },
          ...
        }`);

        // Get user info.
        const getResponse2 = await visaClient.getUser(userKey);
        expect(
          getResponse2.enrollmentRecord.cardDetails.map(({ CardId }) => CardId)
        ).not.to.include(addResponse.cardDetails.cardId);
      });

      afterEach(async function () {
        // Unenroll user.
        await visaClient.unenrollUser(userKey);
      });
    });
  });
});
