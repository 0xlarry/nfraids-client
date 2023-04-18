const { expect } = require("chai");
const { describe } = require("mocha");
const fs = require("fs");
const {Keypair, Connection, clusterApiUrl, PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const {Metaplex, keypairIdentity} = require("@metaplex-foundation/js");
const {fusion} = require('../index.js')
const bs58 = require('bs58');
const { trifleTransfer, calcAttackBuff, showModel } = require("../lib/trifle.js");
const { sendTxForExecution } = require("../lib/requestBuilder.js");

let key = bs58.decode(String(process.env.NFRAID_KEY));
const trifleAuth = Keypair.fromSecretKey(key);
key = fs.readFileSync("./test/devKeypair.json");
const kp = Keypair.fromSecretKey(new Uint8Array(JSON.parse(key)));

const connection = new Connection(clusterApiUrl("devnet"));
describe('TRIFLE OPERATIONS TEST', () => {
    let metaplex, nft, escrowTokens, sft;
    const testTrifleAddress = new PublicKey('FAbArSiT6fJXQipEztDqyzdYQxj2h5XRdWGrCta8h6e9');
    const trifleAuthority = new PublicKey('AEb8XJLe3ChELQC7nN3gB4QB1CBM3diHkYkQe8kc9w8y');
    const aiWeaponSft = new PublicKey('FAZGsPjMXskehuQTuy6Y9phtYq91sZbq2FiBG4DnnuLF');
    const shieldSft = new PublicKey('2d8hLAfecL5b7GzqEZtCfQrRX5Q4BtV2NzwDuyMwufpG');
    let trifleAddress, escrowAddress;
    before("set up", async () => {
        // connect
        metaplex = new Metaplex(connection);
        metaplex.use(keypairIdentity(kp));
        console.log('-- kp pubkey: ', kp.publicKey.toString());

        // create NFT
        ({nft} = await metaplex.nfts().create({
            uri: 'uri.xyz',
            name: 'name', 
        }, {commitment: 'confirmed'}));
        // nft = {address: new PublicKey('3FNf9TN6xwPhuvWbScX96H5yf9LBHLcMwHB8JNuHygzV')};
        console.log('-- nft address: ', nft.address.toString());

        ([trifleAddress] = fusion.findTriflePda(nft.address, trifleAuthority));
        ([escrowAddress] = fusion.findEscrowPda(nft.address, trifleAddress));

        // await showModel(connection, testTrifleAddress, true);
    });

    it('should create trifle account for NFT', async () => {
        let tx = await fusion.createTrifleAccount(nft, kp.publicKey, testTrifleAddress, trifleAuthority);
        const latestBlockHash = await connection.getLatestBlockhash();
        tx.recentBlockhash = latestBlockHash.blockhash;
        tx.feePayer = kp.publicKey;
        tx.partialSign(kp);
        const serialized = tx.serialize({requireAllSignatures: false, verifySignatures: false});
        const result = await sendTxForExecution(serialized, 'trifle');
        expect(result.status).eql(200, JSON.stringify(result));

        ([trifleAddress] = fusion.findTriflePda(nft.address, trifleAuthority));
        escrowTokens = await fusion.getTrifleTokens(connection, trifleAddress);
        expect(escrowTokens).eql({});
    });

    it('should transfer in SFT', async () => {
        const tx = await trifleTransfer(connection, metaplex, kp.publicKey, nft.address, escrowAddress, aiWeaponSft, trifleAuthority, 'attack', 'in');
        await simulateWalletSignExecute(tx, kp);

        escrowTokens = await fusion.getTrifleTokens(connection, trifleAddress);
        expect(escrowTokens.attack.length).eql(1);
        expect(escrowTokens.attack[0].mint).eql(aiWeaponSft);
    });

    it('should calculate attack buff', async () => {
        const ab = await calcAttackBuff(connection, 's1', nft.address);
        expect(ab).to.eql(10);
    });

    it('should transfer out SFT', async () => {
        const tx = await trifleTransfer(connection, metaplex, kp.publicKey, nft.address, escrowAddress, shieldSft, trifleAuthority, 'haste', 'out');
        await simulateWalletSignExecute(tx, kp);

        escrowTokens = await fusion.getTrifleTokens(connection, trifleAddress);
        expect(escrowTokens).to.not.have.property('attack');
    });

    it('should burn token into escrow', async () => {
        escrowTokens = await fusion.getTrifleTokens(connection, trifleAddress);
        const {nft: n2} = await metaplex.nfts().create({
            uri: 'uri.xyz',
            name: 'name', 
        }, {commitment: 'finalized'});
        console.log('-- nft to burn address: ', nft.address.toString());
        const tx = await trifleTransfer(connection, metaplex, kp.publicKey, nft.address, escrowAddress, n2.address, trifleAuthority, 'burn', 'in');
        await simulateWalletSignExecute(tx, kp);
        const newTokens = await fusion.getTrifleTokens(connection, trifleAddress);
        expect(escrowTokens.burn?.length || 0).eql(newTokens.burn.length - 1, JSON.stringify(newTokens));
    })
});

const simulateBackendSignature = async (connection, serializedTx) => {
    const tx = Transaction.from(serializedTx); // remember to add .data back
    if (tx.instructions.length !== 1 || tx.instructions[0].programId.toString() !== 'trifMWutwBxkSuatmpPVnEe7NoE3BJKgjVi8sSyoXWX') {
        return {
            statusCode: 400,
            reason: 'Bad input'
        };    
    }
    
    let signature;
    try {
        tx.partialSign(trifleAuth);
        serializedTx = tx.serialize();
        signature = await connection.sendRawTransaction(serializedTx, {skipPreflight: true, commitment: 'confirmed' });
        console.log('-- Signature: ', signature);
        await connection.confirmTransaction(signature, 'finalized');
    } catch (err) {
        console.log("-- Failure: ",  signature);
        return {
            status: 500,
            error: err
        };
    }
    console.log("-- Success: ",  signature);
    return {
        status: 200,
        signature
    };
}

const mintSft = async (sft, toOwner) => {
    const metaplex = new Metaplex(connection);
    metaplex.use(keypairIdentity(trifleAuth));
    sft = await metaplex.nfts().findByMint({mintAddress: sft});
    const {response} = await metaplex.nfts().mint({
        nftOrSft: sft,
        authority: trifleAuth,
        toOwner
    });
    console.log(`-- Minted "${sft.name}" to ${toOwner.toString()}: `, response.confirmResponse.value.err ? 'failed!' : 'succeeded!')
    return sft;
}

const simulateWalletSignExecute = async (tx, keypair) => {
    try {
        const sig = await sendAndConfirmTransaction(connection, tx, [keypair], {commitment: 'confirmed', skipPreflight: true});
        await connection.confirmTransaction(sig, 'finalized');
        return sig;
    } catch (e) {
        console.log(e)
    }
};