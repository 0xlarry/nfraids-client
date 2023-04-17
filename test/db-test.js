const { expect } = require("chai");
const { describe } = require("mocha");
const {fetchGameState, fetchCoolDown} = require('../lib/db.js');


describe('DB TESTS', () => {
    it('should get game state', async () => {
        const state = await fetchGameState('s1');
        expect(state).to.have.property('collections');
        expect(state).to.have.property('cooldown');
        expect(state).to.have.property('items');
        expect(state).to.have.property('fees');
        expect(state).to.have.property('name');
        expect(state).to.have.property('target');
        expect(state).to.have.property('trifleAuthority');
        expect(state).to.have.property('id');
    });

    it('should get cooldown', async () => {
        const result = await fetchCoolDown('s1', '8he9T1UG2vuceUbJ12WRZa8uF8DNRoRmsippwYWrNukC');
        expect(result.status).eql(200);
        expect(result.cooldowns).to.have.property('loot');
        expect(result.cooldowns).to.have.property('boss');
    });
});