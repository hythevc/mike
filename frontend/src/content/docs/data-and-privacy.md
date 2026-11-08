<!-- SPDX-License-Identifier: AGPL-3.0-only -->

> This is legal information, not legal advice. The [Privacy Notice]({{privacyUrl}}), the [Data Processing Agreement]({{dpaUrl}}) and the [sub-processor list]({{subprocessorsUrl}}) are the documents that bind {{legalEntityName}}; this page explains how the product behaves.

## What is stored

{{productName}} stores the documents you upload, the chats, reviews, workflows and playbooks you create, the decisions you record, your account details, and an audit log of actions taken in your account. Documents are kept in object storage and everything else in the database, both run by the operator in the region stated in the sub-processor list. A document you delete is removed from storage after the retention period the Privacy Notice states.

## Model providers

The text you choose to analyse, and the questions you ask about it, are sent to the model provider a request runs on: your own key, your organization's key, or the deployment's key where the operator provides one. The providers in use, the region their inference runs in, and whether they retain content are listed in [How we use AI]({{aiTransparencyUrl}}). {{legalEntityName}} does not train models on your content and uses providers only under terms that do not allow training on it.

## AI use on a matter

A matter's responsible lawyer can switch AI off for that matter, for a client who has restricted it. Model work on the matter is then refused before any provider is called, and the switch is recorded in the audit log. The audit entry for each chat turn lists the documents the assistant read, and a matter's AI usage can be downloaded as a CSV file showing who ran what, when, on which model and key, with the tokens used and an estimated cost, so AI cost can be passed through at cost. For the words a firm can give its own clients, see [Using AI on your matter]({{clientAiUseUrl}}).

## Connected systems

Connectors to email, calendars, document stores and messaging tools act only within the permissions you grant them. Actions that write to a connected system, such as sending an email or changing a calendar event, wait for your approval by default; you can see each proposed action before it runs.

## Export

You can export your account as a JSON file, and your chats, tabular reviews, documents, memory and audit history as separate downloads, from Settings. Exports of a matter carry a manifest of file hashes, so a recipient can check that a file was not altered after it was exported. Where an authenticator app is set on your account, exports ask for a current code.

## Deletion

You can delete chats, tabular reviews, matters and memory one kind at a time, and delete your account, from Settings. Deleting your account removes your personal history; your actions in an organization's audit log are kept but no longer attributed to you by name. An organization owner can delete the organization. Request desk entries and other organization records are removed with the organization.

## Error reporting and analytics

{{productName}} sends no usage analytics. Error reporting to an outside service is off unless the operator configures a destination; when it is on, reports carry no document text, request bodies, cookies, authorization headers or email addresses.

## Questions

Write to [{{supportEmail}}](mailto:{{supportEmail}}). Security questions and vulnerability reports go to [{{securityEmail}}](mailto:{{securityEmail}}); see the [Security page]({{securityUrl}}).
