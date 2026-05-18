/**
 * Server-only: drafts a clarification email via Azure OpenAI for settlement readiness.
 */

import { AIClient } from "@/lib/AIClient";
import type { DealAmbiguityClarificationQuestion } from "@/lib/dealAmbiguity";

const clarificationEmailClient = new AIClient();

const CLARIFICATION_EMAIL_PROMPT = `You are helping a live event settlement operator draft a short clarification email to an agent or promoter.

The goal is to confirm payout-impacting settlement assumptions before settlement calculations begin.

Write a short professional email that:

* is concise and operational
* sounds human and natural
* is easy to paste into an existing email thread
* asks only the necessary clarification questions
* keeps the tone collaborative and low-friction

Do NOT:

* mention AI
* summarize the entire deal
* sound overly formal or legal
* add unnecessary explanations

Use the following clarification questions:

{{CLARIFICATION_QUESTIONS}}

Return ONLY the email body text.`;

function formatClarificationQuestionsForPrompt(
  questions: DealAmbiguityClarificationQuestion[]
): string {
  return questions
    .map((q, i) => {
      const opts = q.options.map((o) => `  - ${o}`).join("\n");
      return `${i + 1}. ${q.question}\n${opts}`;
    })
    .join("\n\n");
}

export async function generateClarificationEmailBody(
  questions: DealAmbiguityClarificationQuestion[]
): Promise<string> {
  if (!questions.length) {
    throw new Error("No clarification questions to include.");
  }
  const blob = formatClarificationQuestionsForPrompt(questions);
  const userMessage = CLARIFICATION_EMAIL_PROMPT.replace(
    "{{CLARIFICATION_QUESTIONS}}",
    blob
  );
  const text = await clarificationEmailClient.completeAI(userMessage, {
    temperature: 0.35,
    maxTokens: 1200,
  });
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Model returned an empty email body.");
  }
  return trimmed;
}
