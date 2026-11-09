# Eval Requirement

Add or improve one lightweight eval for assistant quality.

The eval should capture behavior rather than implementation details. Strong evals cover one of:

- Vague prompts trigger useful clarifying questions.
- Broad build requests ask for constraints before giving implementation advice.
- Concrete requests produce ordered next steps.
- Risk questions mention assumptions and verification.
- The UI/API preserves conversation context across turns.

Keep the eval small enough to run inside `npm test`. In final notes, briefly say what bad assistant behavior your eval would catch.
