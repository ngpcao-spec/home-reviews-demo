import {requireUser} from '../_shared/auth.ts';
import {recommendationTestHandler} from '../_shared/recommendation-test-api.ts';

Deno.serve(recommendationTestHandler(requireUser));
