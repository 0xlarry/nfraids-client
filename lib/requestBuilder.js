const { unmarshall } = require("@aws-sdk/util-dynamodb");
const {
    PublicKey, Transaction, TransactionInstruction, SystemProgram, LAMPORTS_PER_SOL
} = require("@solana/web3.js");
const { default: axios } = require("axios");
const {consumePubKey, memoProgramId, apiEndpoint} = require('./constants.js')

const createMemoContentInstruction = (signerPubKey, recipientPubKey, memoContent) => {
    if (typeof(memoContent) !== 'string') {
        memoContent = JSON.stringify(memoContent);
    }
    return new TransactionInstruction({
        keys: [{ pubkey: signerPubKey, isSigner: true, isWritable: true },
                { pubkey: recipientPubKey, isSigner: true, isWritable: true }],
        data: Buffer.from(memoContent, "utf-8"),
        programId: new PublicKey(memoProgramId)
    });
}

const signAndSerialize = async (connection, keypair, tx) => {
    const latestBlockHash = await connection.getLatestBlockhash();
    tx.recentBlockhash = latestBlockHash.blockhash;
    tx.feePayer = keypair.publicKey;
    
    tx.partialSign(keypair);
    return tx.serialize({requireAllSignatures: false, verifySignatures: false});
}

const createTransferInstruction = (fromPublicKey, toPublicKey, amountInSol) => {
    const lamports = LAMPORTS_PER_SOL * amountInSol;
    const ix = SystemProgram.transfer({
      fromPubkey: fromPublicKey,
      toPubkey: toPublicKey,
      lamports,
    });
    return ix;
}

const createRequestTx = async (clientPubkey, nftAddress, collectionAddress, seasonId, target, action) => {
    let {data: {Item: data}} = await axios.get(`${apiEndpoint}/state/${seasonId}`);
    data = unmarshall(data || {});
    const memoContent = {
        nftAddress,
        collectionAddress,
        seasonId,
        target,
        action
    };
    const tx = new Transaction();
    tx.add(createMemoContentInstruction(clientPubkey, new PublicKey(consumePubKey), memoContent));
    if (action === 'attack' && data?.fees) {
        data.fees.map(x => {
            tx.add(createTransferInstruction(clientPubkey, new PublicKey(x.address), x.sol));
        })
    }
    return tx;
}

const sendTxForExecution = async (serializedTx, endpoint) => {
    const {data} = await axios.post(`${apiEndpoint}/${endpoint}`, {
        serializedTx
    });
    return data;
}

module.exports = {
    createRequestTx,
    signAndSerialize,
    sendTxForExecution
}