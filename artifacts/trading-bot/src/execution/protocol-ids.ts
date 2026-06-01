import { PublicKey } from '@solana/web3.js';

export const RAYDIUM_CLMM_PROGRAM = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
export const RAYDIUM_CPMM_PROGRAM = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
export const ORCA_WHIRLPOOL_PROGRAM = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
export const METEORA_DLMM_PROGRAM = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');

export const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bRX');
export const SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');
export const SYSVAR_RENT = new PublicKey('SysvarRent111111111111111111111111111111111');
export const METAPLEX_METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

function bytes(...values: number[]) {
  return Buffer.from(values);
}

export const RaydiumClmmSeeds = {
  POOL_STATE: Buffer.from('pool'),
  TICK_ARRAY: Buffer.from('tick_array'),
  PERSONAL_POSITION: Buffer.from('personal_position'),
  PROTOCOL_POSITION: Buffer.from('position'),
  OBSERVATION_STATE: Buffer.from('observation'),
  BITMAP_EXTENSION: Buffer.from('pool_tick_array_bitmap_extension'),
} as const;

export const RaydiumCpmmSeeds = {
  POOL_STATE: Buffer.from('pool'),
  POOL_AUTH: Buffer.from('vault_and_lp_mint_auth_seed'),
  LP_MINT: Buffer.from('pool_lp_mint'),
  VAULT_0: Buffer.from('pool_vault'),
} as const;

export const OrcaSeeds = {
  WHIRLPOOL: Buffer.from('whirlpool'),
  TICK_ARRAY: Buffer.from('tick_array'),
  POSITION: Buffer.from('position'),
  POSITION_METADATA: Buffer.from('position_metadata'),
  ORACLE: Buffer.from('oracle'),
} as const;

export const MeteoraSeeds = {
  LB_PAIR: Buffer.from('lb_pair'),
  BIN_ARRAY: Buffer.from('bin_array'),
  POSITION: Buffer.from('position'),
  POSITION_V2: Buffer.from('position_v2'),
  ORACLE: Buffer.from('oracle'),
  BIN_ARRAY_BITMAP: Buffer.from('bitmap'),
} as const;

export const RaydiumClmmDiscriminators = {
  OPEN_POSITION: bytes(135, 128, 47, 77, 15, 152, 240, 49),
  CLOSE_POSITION: bytes(123, 134, 81, 0, 49, 68, 98, 98),
  INCREASE_LIQUIDITY: bytes(46, 156, 243, 118, 13, 205, 251, 178),
  DECREASE_LIQUIDITY: bytes(160, 38, 208, 111, 104, 91, 202, 1),
  COLLECT_REMAINING_REWARDS: bytes(18, 237, 166, 197, 34, 16, 213, 144),
  SWAP_V2: bytes(43, 4, 237, 11, 26, 201, 30, 98),
} as const;

export const RaydiumCpmmDiscriminators = {
  SWAP_BASE_INPUT: bytes(143, 190, 90, 218, 196, 30, 51, 222),
  SWAP_BASE_OUTPUT: bytes(55, 217, 98, 86, 163, 74, 180, 173),
  ADD_LIQUIDITY: bytes(181, 157, 89, 67, 143, 182, 52, 72),
  REMOVE_LIQUIDITY: bytes(80, 85, 209, 72, 24, 206, 177, 108),
} as const;

export const OrcaDiscriminators = {
  OPEN_POSITION: bytes(135, 128, 47, 77, 15, 152, 240, 49),
  OPEN_POSITION_WITH_METADATA: bytes(242, 29, 134, 48, 58, 110, 14, 60),
  CLOSE_POSITION: bytes(123, 134, 81, 0, 49, 68, 98, 98),
  INCREASE_LIQUIDITY: bytes(46, 156, 243, 118, 13, 205, 251, 178),
  DECREASE_LIQUIDITY: bytes(160, 38, 208, 111, 104, 91, 202, 1),
  COLLECT_FEES: bytes(164, 152, 207, 99, 30, 186, 19, 182),
  SWAP: bytes(248, 198, 158, 145, 225, 117, 135, 200),
} as const;

export const MeteoraDiscriminators = {
  INITIALIZE_POSITION: bytes(219, 192, 234, 71, 190, 191, 199, 128),
  ADD_LIQUIDITY: bytes(181, 157, 89, 67, 143, 182, 52, 72),
  REMOVE_LIQUIDITY: bytes(80, 85, 209, 72, 24, 206, 177, 108),
  SWAP: bytes(248, 198, 158, 145, 225, 117, 135, 200),
  CLOSE_POSITION: bytes(123, 134, 81, 0, 49, 68, 98, 98),
  CLAIM_FEE: bytes(169, 32, 79, 137, 136, 232, 70, 137),
} as const;
