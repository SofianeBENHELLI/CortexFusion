import { Context, Service } from '@deepseek-ai/cordis';
import { CoreClient, type CoreClientConfig } from './core-client.js';

declare module '@deepseek-ai/cordis' {
  interface Context { cortexKnowledge: CortexKnowledgeService }
}

export class CortexKnowledgeService extends Service {
  readonly client: CoreClient;
  constructor(ctx: Context, config: CoreClientConfig) {
    super(ctx, 'cortexKnowledge');
    this.client = new CoreClient(config);
    ctx.effect(() => () => this.client.dispose());
  }
}

export const name = 'cortex-fusion-knowledge';

/** Mount per authenticated tenant/domain session, never as one global shared credential. */
export function apply(ctx: Context, config: CoreClientConfig) {
  ctx.plugin(CortexKnowledgeService, config);
}
