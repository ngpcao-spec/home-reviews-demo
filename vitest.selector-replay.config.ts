import {mergeConfig} from 'vitest/config';
import base from './vitest.config.ts';
export default mergeConfig(base,{test:{environment:'node',include:['tests/offline/sol-selector-corpora.replay.ts']}});
