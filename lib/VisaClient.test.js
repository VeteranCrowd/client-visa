/* eslint-env mocha */

// npm imports
import chai, { expect } from 'chai';
import chaiMatchPattern from 'chai-match-pattern';

chai.use(chaiMatchPattern);

// lib imports
import { VisaClient } from './index.js';

describe('VisaClient', function () {
  let config;

  before(async function () {
    config = {
      baseUrl: process.env.VISA_API_BASE_URL,
      clientCert: process.env.VISA_API_CLIENT_CERT,
      clientKey: process.env.VISA_API_PRIVATE_KEY,
      communityCode: process.env.VISA_API_COMMUNITY_CODE,
      passphrase: process.env.VISA_API_PASSWORD,
      userId: process.env.VISA_API_USER_ID,
    };
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
      const visaClient = new VisaClient(config);
      const response = await visaClient.helloWorld();
      expect(response).to.matchPattern(`{
        message: 'helloworld',
        timestamp: _.isDateString
      }`);
    });
  });
});
