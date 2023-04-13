const { unmarshall } = require('@aws-sdk/util-dynamodb');
const requestBuilder = require('./lib/requestBuilder.js');
const fusion = require('./lib/trifle.js');
const {apiEndpoint} = require('./lib/constants.js');
const axios = require('axios');

const fetchGameState = async (id) => {
    const {data: result} = await axios.get(`${apiEndpoint}/state/${id}`);
    return unmarshall(result);
}

module.exports = {
    requestBuilder,
    fusion,
    fetchGameState
};