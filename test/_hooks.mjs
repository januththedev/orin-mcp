/** Must load before anything else in node --test via --import. */
import { register } from 'node:module';

register(new URL('./_resolve-hook.mjs', import.meta.url));
