import { z } from "zod";
import { RUBRIC_CRITERIA, rubricWeightsForStorage, validateRubricWeights, type RubricWeights } from "@/app/lib/domain/rubric";

const weightField = z.number().int("Weights must be whole numbers.").min(0).max(100);

/**
 * zod schema for scoring weights in request bodies. Accepts null (use default
 * weighting) or an object with every criterion as an integer percentage that
 * sums to exactly 100. Output is the value to store (default weights → null).
 */
export const scoringWeightsSchema = z
  .object(
    Object.fromEntries(RUBRIC_CRITERIA.map((criterion) => [criterion.key, weightField])) as Record<
      keyof RubricWeights,
      typeof weightField
    >
  )
  .strict()
  .nullable()
  .superRefine((value, ctx) => {
    if (value === null) return;
    const result = validateRubricWeights(value);
    if (!result.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error });
  })
  .transform((value) => rubricWeightsForStorage(value as RubricWeights | null));
