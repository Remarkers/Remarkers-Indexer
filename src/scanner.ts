import { ApiPromise, WsProvider } from '@polkadot/api';
import { Config, Content, Inscription, assertContent } from './types.js';

class Scanner {
  config: Config;

  private api!: ApiPromise;

  constructor(config: Config) {
    this.config = config;
  }

  async init() {
    const wsProvider = new WsProvider(this.config.chainEndpoint);
    this.api = await ApiPromise.create({ provider: wsProvider });
  }

  async reconnect() {
    await this.api.disconnect();
    await this.init();
  }

  private async getHeadBlockNumber(): Promise<number> {
    const finalizedHead = await this.api.rpc.chain.getFinalizedHead();
    const header = await this.api.rpc.chain.getHeader(finalizedHead);
    return header.number.toNumber();
  }

  private async resolveBlock(number: number): Promise<Inscription[]> {
    const blockHash = await this.api.rpc.chain.getBlockHash(number);
    const signedBlock = await this.api.rpc.chain.getBlock(blockHash);
    if (!signedBlock.block.extrinsics.length) {
      return [];
    }
    let blockTime: number | undefined;
    return (
      await Promise.all(
        signedBlock.block.extrinsics.map(async (ex, ei) => {
          if (
            ex.method.method === 'batchAll' &&
            ex.method.section === 'utility'
          ) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const methodJson = ex.method.toHuman() as any;
            if (!methodJson?.args?.calls || !methodJson.args.calls.length) {
              return;
            }

            const call0 = methodJson.args.calls[0];
            if (
              call0?.method !== 'remarkWithEvent' ||
              call0?.section !== 'system'
            ) {
              return;
            }

            const rawRemark = call0.args.remark as string;
            const remark = rawRemark.toLowerCase();
            // Try to parse and validate the content
            let content: Content;
            try {
              content = assertContent(remark);
            } catch (e) {
              console.warn('failed to parse content', remark, e);
              return;
            }

            if (!blockTime) {
              blockTime = await this.getBlockTime(blockHash);
            }

            return {
              blockNumber: number,
              extrinsicHash: ex.hash.toHex(),
              extrinsicIndex: ei,
              sender: ex.signer.toString(),
              rawContent: rawRemark,
              content: content,
              timestamp: new Date(blockTime),
            } as Inscription;
          }
        }),
      )
    )
      .filter((e) => e)
      .map((e) => e as Inscription);
  }

  // eslint-disable-next-line no-unused-vars
  async scan(handler: (blockInscriptions: Inscription[]) => Promise<void>) {
    let current = this.config.scanStartBlock;
    let headBlockNumber = await this.getHeadBlockNumber();
    const startTime = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        if (current > headBlockNumber) {
          console.log('waiting for new blocks');
          await new Promise((resolve) => setTimeout(resolve, 5000));
          headBlockNumber = await this.getHeadBlockNumber();
          continue;
        }

        const diff = headBlockNumber - current;
        const blocksToScan = Math.min(diff, this.config.scanConcurrency);
        const tasks = Array.from({ length: blocksToScan }, (_, i) =>
          this.resolveBlock(current + i),
        );

        const blockInscriptionsBatch = await Promise.all(tasks);
        for (const blockInscriptions of blockInscriptionsBatch) {
          if (!blockInscriptions.length) {
            continue;
          }
          await handler(blockInscriptions);
        }

        const used = (Date.now() - startTime) / 1000;
        const scaned = current - this.config.scanStartBlock;
        console.log(
          `scanning blocks ${current} to ${current + blocksToScan - 1}: head=${headBlockNumber}, progress=${(
            (current / headBlockNumber) *
            100
          ).toFixed(2)}%, used=${used.toFixed(2)}s, remaining=${(
            (used / scaned) *
            (headBlockNumber - current)
          ).toFixed(2)}s, speed=${(scaned / used).toFixed(2)} blocks/s`,
        );

        current += blocksToScan;
      } catch (error) {
        console.error('scan error', error);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await this.reconnect();
      }
    }
  }

  private async getBlockTime(blockHash: Uint8Array | string): Promise<number> {
    const apiAt = await this.api.at(blockHash);
    return parseInt((await apiAt.query.timestamp.now()).toString());
  }
}

export default Scanner;
