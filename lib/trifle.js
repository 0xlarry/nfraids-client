const { 
    Connection, clusterApiUrl, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, 
    Transaction, sendAndConfirmTransaction, SystemProgram: {programId: SYSTEM_PROGRAM},
    Keypair, TransactionInstruction, LAMPORTS_PER_SOL
} = require("@solana/web3.js");
const { 
    Metaplex, keypairIdentity, CanceledBidIsNotAllowedError, token
} = require("@metaplex-foundation/js");
const {
    PROGRAM_ADDRESS: TOKEN_METADATA_PROGRAM_ADDRESS, 
} = require("@metaplex-foundation/mpl-token-metadata");
const { 
    createCreateTrifleAccountInstruction, PROGRAM_ADDRESS: TRIFLE_PROGRAM_ADDRESS,
    Trifle, createTransferInInstruction, createTransferOutInstruction, EscrowConstraintModel,
    createCreateEscrowConstraintModelAccountInstruction, createAddCollectionConstraintToEscrowConstraintModelInstruction,
    TransferEffects
} = require('@metaplex-foundation/mpl-trifle');
const { 
    getAssociatedTokenAddress, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createMintToInstruction,
    createAssociatedTokenAccount, getAssociatedTokenAddressSync
} = require('@solana/spl-token');
const bs58 = require('bs58');

let key = bs58.decode(String(process.env.NFRAID_KEY));
const trifleAuth = Keypair.fromSecretKey(key);
const connection = new Connection(clusterApiUrl("devnet"));
const createTrifleAccount = async (nft, nftOwner, constraintModelAccount, trifleAuthority) => {
    let nftTokenAccountAddress = await getAssociatedTokenAddress(nft.address, nftOwner);
    let [trifleAddress] = findTriflePda(nft.address, trifleAuthority);
    let [escrowAddress] = findEscrowPda(nft.address, trifleAddress);
  
    const ix = createCreateTrifleAccountInstruction({
        escrow: escrowAddress,
        metadata: nft.metadataAddress,
        mint: nft.address,
        tokenAccount: nftTokenAccountAddress,
        edition: nft.edition.address,
        trifleAccount: trifleAddress,
        trifleAuthority: trifleAuthority,
        constraintModel: constraintModelAccount,
        payer: nftOwner,
        tokenMetadataProgram: new PublicKey(TOKEN_METADATA_PROGRAM_ADDRESS),
        systemProgram: SYSTEM_PROGRAM,
        sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
    });

    const tx = new Transaction();
    tx.add(ix);
    return tx;
    // return await signAndSerialize(connection, trifleAuth, tx);
}

const signAndSerialize = async (connection, keypair, tx) => {
    const latestBlockHash = await connection.getLatestBlockhash();
    tx.recentBlockhash = latestBlockHash.blockhash;
    tx.feePayer = keypair.publicKey;
    
    tx.partialSign(keypair);
    return tx.serialize({requireAllSignatures: false, verifySignatures: false});
}

const findTriflePda = (mint, authority) => {
    return PublicKey.findProgramAddressSync(
        [
          Buffer.from("trifle"),
          mint.toBuffer(),
          authority.toBuffer(),
        ],
        new PublicKey(TRIFLE_PROGRAM_ADDRESS),
      );
  }
  
  const findEscrowPda = (mint, authority) => {    
    return PublicKey.findProgramAddressSync(
        [
            Buffer.from("metadata"),
            new PublicKey(TOKEN_METADATA_PROGRAM_ADDRESS).toBuffer(),
            mint.toBuffer(),
            Uint8Array.from([1]),
            authority.toBuffer(),
            Buffer.from("escrow")
        ],
        new PublicKey(TOKEN_METADATA_PROGRAM_ADDRESS),
    );
  }

const getTrifleTokens = async (connection, trifleAddress, fullAccount = false) => {
    const accountInfo = await connection.getAccountInfo(trifleAddress);
    if (accountInfo) {
        const account = Trifle.fromAccountInfo(accountInfo)[0];
        if (fullAccount) {
            return account;
        }
        return Object.fromEntries(account.tokens);
    } else {
        console.log("Unable to fetch account");
        return false;
    }
};

async function getTokenOwner(metaplex, nftPubKey) {
    const ownerAccounts = await metaplex.connection.getTokenLargestAccounts(nftPubKey);
    const ownerInfo = await metaplex.connection.getParsedAccountInfo(ownerAccounts.value[0].address);
    return new PublicKey((ownerInfo?.value?.data).parsed?.info?.owner);
}

const trifleTransfer = async (connection, metaplex, tokenOwner, parentNftAddress, escrowAccountAddress, childNftAddress, creator, slot, inOut) => {
    const [trifleAddress] = findTriflePda(parentNftAddress, creator);
    const accountInfo = await connection.getAccountInfo(trifleAddress);
  
    let escrowConstraintModel;
    if (accountInfo) {
        const account = Trifle.fromAccountInfo(accountInfo)[0];
        escrowConstraintModel = account.escrowConstraintModel;
    } else {
        console.log("Unable to fetch Trifle account");
        return false;
    }
    const childNft = await metaplex.nfts().findByMint({
        mintAddress: childNftAddress, 
        tokenOwner: await getTokenOwner(metaplex, childNftAddress)
    });
    const parentNft = await metaplex.nfts().findByMint({
        mintAddress: parentNftAddress, 
        tokenOwner: await getTokenOwner(metaplex, parentNftAddress)
    });
    let collectionMetadataAddress = null;
    if (childNft.collection?.key) {
        collectionMetadataAddress = await metaplex.nfts().findByMint({mintAddress: childNft.collection.key});
        collectionMetadataAddress = collectionMetadataAddress.metadataAddress;
    }

    let transferIX;
    if (inOut === 'in') {
        const dst = await getAssociatedTokenAddress(
            childNft.mint.address,
            escrowAccountAddress,
            true,
        );
        transferIX = createTransferInInstruction({
            trifle: trifleAddress,
            trifleAuthority: creator,
            payer: tokenOwner,
            constraintModel: escrowConstraintModel,
            escrow: escrowAccountAddress,
            escrowMint: parentNft.address, 
            escrowToken: parentNft.token.address,
            escrowEdition: parentNft.edition.address,
            attributeMint: childNft.mint.address,
            attributeSrcToken: childNft.token.address,
            attributeDstToken: dst,
            attributeMetadata: childNft.metadataAddress,
            attributeEdition: childNft.edition?.address || null,
            attributeCollectionMetadata: collectionMetadataAddress,
            systemProgram: SYSTEM_PROGRAM,
            splToken: new PublicKey(TOKEN_PROGRAM_ID),
            splAssociatedTokenAccount: new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
            tokenMetadataProgram: new PublicKey(TOKEN_METADATA_PROGRAM_ADDRESS),
        },{
            transferInArgs: { amount: 1, slot },
        });
    } else if (inOut === 'out') {
        const dst = await getAssociatedTokenAddress(
            childNft.mint.address,
            tokenOwner,
            true,
        );
        transferIX = createTransferOutInstruction({
            trifleAccount: trifleAddress,
            constraintModel: escrowConstraintModel,
            escrowAccount: escrowAccountAddress,
            escrowTokenAccount: parentNft.token.address,
            escrowMint: parentNft.mint.address,
            escrowMetadata: parentNft.metadataAddress,
            payer: tokenOwner,
            trifleAuthority: creator,
            attributeMint: childNft.mint.address,
            attributeSrcTokenAccount: childNft.token.address,
            attributeDstTokenAccount: dst,
            attributeMetadata: childNft.metadataAddress,
            splAssociatedTokenAccount: new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
            splToken: new PublicKey(TOKEN_PROGRAM_ID),
            tokenMetadataProgram: new PublicKey(TOKEN_METADATA_PROGRAM_ADDRESS),
            sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        },{
            transferOutArgs: { amount: 1, slot },
        });
    }
  
    return new Transaction().add(transferIX);
};

module.exports = {
    createTrifleAccount,
    findTriflePda,
    findEscrowPda,
    getTrifleTokens,
    getTokenOwner,
    trifleTransfer
}