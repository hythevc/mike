<!-- SPDX-License-Identifier: AGPL-3.0-only -->

> This is legal information, not legal advice. This page states what the software does today. It is not a certification. Where the summary lists something that is not in place yet, it says so and gives the date it is due.

{{productName}} is operated by {{legalEntityName}}. The complete source code of the running service is public under the GNU Affero General Public License v3.0 only, at [{{sourcePagePath}}]({{sourcePagePath}}), so every statement below can be checked against the code.

## Summary

{{securityFactsSummary}}

## Stored provider keys

A model provider key you save in the product is encrypted before it is stored, with AES-256-GCM and a key derived from a secret that only the operator holds. It is decrypted only to make the model calls you ask for, and it is never returned to a browser. A key the operator configures for the deployment is held in the server’s environment, not in the database.

## Sign-in and sessions

Sessions are carried in cookies the browser cannot read from script (HttpOnly). In production the cookies are marked Secure with the `__Host-` prefix, and the server refuses to start unless its public addresses use HTTPS. Failed sign-ins are limited per address and per account.

## Multi-factor authentication

You can add an authenticator app (time-based one-time codes) to your account. Once it is set, exporting data, deleting data, deleting the account and changing provider keys ask for a current code, and you can require a code at every sign-in.

## Single sign-on

SAML single sign-on is available when the operator enables it and names the email domains it applies to. It is off by default.

## Audit log and what it records

Every recorded event stores who acted (account id and email), the action, its status, a short title, the part of the product it came from, the matter, chat, document or review it concerns, the model used where one was, and details specific to the action. A chat event records which documents the assistant read. Members see their own activity under Settings; organization owners and administrators see the organization’s log and can export it as CSV (up to 2,000 events per export). Audit access does not grant access to the content itself: titles and details of private work the viewer cannot open are redacted.

## Export and deletion

You can export your account data as JSON, and your chats, tabular reviews, documents, memory and audit history as separate files, at any time. You can delete chats, tabular reviews, matters and memory one kind at a time, and delete your account. An organization owner can delete the organization. Retention periods are stated in the [Privacy Notice]({{privacyUrl}}).

## Model providers and training

The text you choose to analyse is sent to the model providers the deployment is configured with. {{legalEntityName}} does not train models on your content and uses providers only under terms that do not allow training on it. The configured providers, their region and their retention or zero-data-retention terms are:

{{modelProvidersTable}}

The full statement is in [How we use AI]({{aiTransparencyUrl}}); the hosting and service providers are in the [sub-processor list]({{subprocessorsUrl}}).

## Matter-level controls

The responsible lawyer can switch AI off for a matter whose client has restricted it. Model work on that matter is then refused before any provider is called, and the change is recorded in the audit log. Actions that write to a connected system, such as sending an email or editing a calendar, wait for approval by default.

## Error reporting

Error reporting to an outside service is off unless the operator configures a destination. When it is on, reports carry no document text, request bodies, cookies, authorization headers or email addresses.

## Independent certification

{{certificationStatement}}

## Reporting a vulnerability

Report security issues to [{{securityEmail}}](mailto:{{securityEmail}}). The same contact and an expiry date are published at [{{securityTxtPath}}]({{securityTxtPath}}). Please keep testing non-destructive and limited to accounts and data you own.

Document version {{version}}.
