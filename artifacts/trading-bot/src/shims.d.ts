declare module "bn.js" {
  const BN: any;
  export default BN;
}

declare module "@meteora-ag/dlmm" {
  const DLMM: any;
  export default DLMM;
  export const StrategyType: any;
  export function binDeltaToMinMaxBinId(...args: any[]): any;
  export function getPositionLowerUpperBinIdWithLiquidity(...args: any[]): any;
  export function getTokenDecimals(...args: any[]): any;
  export function getTokensMintFromPoolAddress(...args: any[]): any;
  export interface LbPosition {
    [key: string]: any;
  }
}

declare module "pg" {
  export class Pool {
    constructor(config: { connectionString?: string });
  }
}
