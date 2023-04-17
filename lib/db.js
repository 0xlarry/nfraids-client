const axios = require('axios');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { apiEndpoint } = require('./constants.js');
const { deriveTrifleTokens } = require('./trifle.js');

const fetchGameState = async (id) => {
    const {data: {Item}} = await axios.get(`${apiEndpoint}/state/${id}`);
    return unmarshall(Item);
}

const fetchCoolDown = async (id, nftAddress) => {
    const {data} = await axios.post(`${apiEndpoint}/state/cooldown`, {
        id, nftAddress
    });
    return data;
}


module.exports = {
    fetchGameState,
    fetchCoolDown
}