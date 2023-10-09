# Overview
A runnable sample Shopify Payments app based on [Shopify developer document](https://shopify.dev/docs/apps/payments).

# Prerequisite
**You need to get approval to be given the payment API scopes** following [these steps](https://shopify.dev/docs/apps/payments#payments-app-approval-process).

# How to run
Just deploy to Render or heroku or other Pass with the following environment variables is the easiest way to run, or `npm install && npm run start` locally.
```
SHOPIFY_API_KEY:              YOUR_API_KEY

SHOPIFY_API_SECRET:           YOUR_API_SECRET

SHOPIFY_API_VERSION:          2023-04 (or later)

SHOPIFY_MONGO_DB_NAME:        YOUR_DB_NAME (any name is OK)

SHOPIFY_MONGO_URL:            mongodb://YOUR_ID:YOUR_PASSWORD@YOUR_DOMAIN:YOUR_PORT/YOUR_DB_NAME

SHOPIFY_JWT_SECRET:           YOUR_JWT_SECRET (any value is OK)
```

# Installation Endpoint
`https://SHOPIFY_SHOP_DOMAIN/admin/oauth/authorize?client_id=YOUR_API_KEY&scope=write_payment_gateways,write_payment_sessions&redirect_uri=YOUR_APP_URL/callback&state=&grant_options[]=`

**Note that `YOUR_APP_URL` needs to be a public URL hosted by Render or other cloud plarforms or local tunnel URLs like Cloudflare tunnel or ngrok .**

# Map your mTLS paths with payment session fields
https://shopify.dev/apps/payments/creating-a-payments-app/creating-a-payments-app#payments-app-extension-configuration-fields

Payment session URL: `YOUR_APP_URL/payment`

Refund session URL: `YOUR_APP_URL/refund`

Capture session URL: `YOUR_APP_URL/capture`

Void session URL: `YOUR_APP_URL/void`

# Map your webhook paths with GDRP webhooks
https://shopify.dev/apps/webhooks/configuration/mandatory-webhooks

customers/data_request:  `YOUR_APP_URL/webhookgdprcustomerreq`

customers/redact:  `YOUR_APP_URL/webhookgdprcustomerdel`

shop/redact:  `YOUR_APP_URL/webhookgdprshopdel`

# How to complete pending sessions 
Use the following link.

`YOUR_APP_URL/pendingcomplete?shop=SHOPIFY_SHOP_DOMAIN&id=PAYMENT_ID&kind=(sale|authorization)&action=(resolve|reject)&code=(PROCESSING_ERROR|RISKY|AUTHENTICATION_REJECTED|...)&error=ERROR_MESSAGE_FOR_REJECT`

# TIPS
- If you input 500 or 400 or 404 or 405 to customer's first name (given_name) in the shipping address, the app responses that HTTP error status to Shopify's session request body which prevents all following steps. 

- If you input 'delay-XXX (XXX = nummeric like 10)' to customer's last name (family_name) in the shipping address, the app delay the response in that seconds to Shopify's session request body which produces an error or warning.

- If you refund / capture with the amount of 999, the app calls reject mutation for checking how the rejections work.

- Even if your redirection to the Shopify thank you page **FAILS** for some reason (the buyer's network issue, etc.) but `PaymentSessionResolve / Pending` API can be executed successfully in your server, **Shopify makes the order with the status to send a thank you email to the buyer** (which means, you should **NOT** call those APIs before the buyer make a payment).

# Best practice
Use `group` in the payment session body to prevent from unexpected duplicated paymwents for a single order.
https://shopify.dev/docs/apps/payments/implementation/process-an-offsite-payment






