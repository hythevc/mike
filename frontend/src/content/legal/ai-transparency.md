<!-- SPDX-License-Identifier: AGPL-3.0-only -->

> This is legal information, not legal advice. It explains how {{productName}} uses AI so that a lawyer can decide what to rely on.

{{productName}} helps lawyers review, draft and negotiate documents. Every answer, finding and proposed edit it produces is a draft for a lawyer to check and decide on. {{assistantName}} does not practise law and does not replace a lawyer's judgement.

## Providers we use

{{productName}} sends the text you choose to analyse to the model providers below. {{legalEntityName}} does not train models and does not build its own. The current providers, the region their inference runs in, and how they handle your content are listed here and kept current:

{{modelProvidersTable}}

## Inference region

The deployment runs inference in the region shown for each provider above. {{legalEntityName}} selects providers and regions so that content stays in the stated region during processing. Where a matter needs a specific region, the responsible lawyer can confirm the configured region with {{legalEntityName}} before sending content.

## Retention and zero data retention

For each provider, the table states whether it retains your prompts and outputs or operates under a zero data retention (ZDR) arrangement in which prompts and outputs are not stored after the response is returned. Where a provider retains content for a limited period for abuse monitoring, the period is stated. {{legalEntityName}} stores your documents and the resulting drafts in the service so you can return to them; you can delete them, and deletion is described in the Privacy Notice.

## No training on your content

{{legalEntityName}} does not use your content, prompts or outputs to train or fine-tune any model, and selects providers that make the same commitment for content sent through the service. Where a provider's default would allow training, that provider is not used for your content, or it is used only under a configuration that turns training off.

## What is checked, and what is not

{{productName}} matches each quotation it shows against the source text you gave it and labels what it found: quote found, partly found, not found, no quote, or no readable text. These labels describe what the system checked. They are not a statement that an answer is correct, complete or current. A page that could not be read is flagged, not treated as absent.

## Known limitations

- The models can produce text that is wrong, out of date, or not supported by your documents. Read every answer against the source before relying on it.
- A quotation labelled "found" means the words were located in the source, not that the surrounding reasoning is sound.
- {{productName}} does not give legal advice, does not know your matter's full context, and does not account for law or facts outside the documents and instructions you provide.
- Scanned or image-only pages may not be readable; those are flagged.

Questions about this statement: {{supportEmail}}.

Document version {{version}}.
