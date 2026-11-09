# SDE2 Vibecoding Task: ClawChat

You are building **ClawChat**, a focused AI chat workspace inspired by modern assistant products. This is not a full OpenClaw clone. Your job is to ship a convincing 3-hour vertical slice.

Use OpenCode freely, but treat it as a pair programmer whose output you still own.

## Product Brief

Founders and product engineers often ask a chatbot for help turning vague ideas into a product plan. Generic answers are easy to produce but hard to execute. ClawChat should feel like a productized assistant that:

- keeps conversation context,
- asks clarifying questions when the user is vague,
- turns concrete requests into build steps,
- exposes lightweight quality/eval checks,
- has a UI that feels like a real chat product, not a static demo.

You may design any UI you think best serves the product. You do not need auth, persistence, billing, or a real model call. If you choose to add a model adapter, keep deterministic tests around the core behavior.

## Required Work

1. Create a short `PLAN.md` before coding. Include your intended UX, data flow, and test/eval plan.
2. Improve the chat UI and interaction flow. It should be obvious where the user starts and what happened after they send a message.
3. Implement the missing behavior: before jumping into implementation advice, the assistant should ask for explicit constraints/scope when a build request is broad.
4. Keep these endpoints working:
   - `GET /api/conversations`
   - `POST /api/conversations/:id/messages`
   - `GET /api/eval`
5. Add or improve at least one eval that catches a bad assistant response.
6. Submit final notes with what changed, what you verified, and what you would do next.

## Expected Commands

- `npm run dev`
- `npm test`
- `npm run eval:hidden` is reserved for the hiring platform.

## What We Care About

- Product judgment: does this feel like a usable chatbot product?
- Engineering judgment: is the assistant behavior easy to test and evolve?
- UI quality: can a user understand where to start and what the assistant did?
- Eval quality: would your eval catch a meaningful regression?
- AI collaboration: did you steer the coding agent and review the output?
