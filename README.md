# Overview
A runnable sample Shopify Payments app based on [Shopify developer document](https://shopify.dev/docs/apps/payments).

# Prerequisite
**You need to get approval to be given the payment API scopes** following [these steps](https://shopify.dev/docs/apps/payments#payments-app-approval-process).

# How to run
1. Just deploy to Render or heroku or other Pass with the following environment variables is the easiest way to run, or `npm install && npm run start` locally.
```
SHOPIFY_API_KEY:              YOUR_API_KEY

SHOPIFY_API_SECRET:           YOUR_API_SECRET

SHOPIFY_API_VERSION:          2023-04 (or later)

SHOPIFY_MONGO_DB_NAME:        YOUR_DB_NAME (any name is OK)

SHOPIFY_MONGO_URL:            mongodb://YOUR_ID:YOUR_PASSWORD@YOUR_DOMAIN:YOUR_PORT/YOUR_DB_NAME

SHOPIFY_JWT_SECRET:           YOUR_JWT_SECRET (any value is OK)
```
2. Create `shopify.app.toml` file in the root directory copied from [this page](https://shopify.dev/docs/apps/tools/cli/configuration) and replace each value as follows.
    - _name_ = `YOUR_APP_NAME`
    - _client_id_ = `SHOPIFY_API_KEY`
    - _application_url_ = `YOUR_APP_URL`
    - _handle_ = `YOUR_CREATED_ONE_IN_PARTNER_DASHBOARD`
    - _embedded_ = false
    - _scopes in [access_scopes]_ = "write_payment_gateways,write_payment_sessions"
    - _redirect_urls in [auth]_ = [`YOUR_APP_URL/callback`]
    - _api_version in [webhooks]_ = `SHOPIFY_API_VERSION`
    - _customer_deletion_url in [webhooks.privacy_compliance]_ = `YOUR_APP_URL/webhookgdpr`
    - _customer_data_request_url in [webhooks.privacy_compliance]_ = `YOUR_APP_URL/webhookgdpr`
    - _shop_deletion_url in [webhooks.privacy_compliance]_ = `YOUR_APP_URL/webhookgdpr`

3. Execute `shopify app deploy --reset`.

# Added in 2024.07
The payment extension was migrated to CLI deployment, so you need to do [this migration steps](https://shopify.dev/docs/apps/build/payments/migrate-extensions-to-shopify-cli), too. For payment extension toml file details, check [this page](https://shopify.dev/docs/apps/build/payments/offsite/use-the-cli). Once you run `shopify app deploy`, don't forget to click `Submit for review` in the latest version.

# Map your mTLS paths with payment session fields
Specify the following URLs in `extensions/my-test-pay-ext/shopify.extension.toml` described in [this page](https://shopify.dev/docs/apps/build/payments/offsite/use-the-cli).

payment_session_url =  `YOUR_APP_URL/payment`

refund_session_url =  `YOUR_APP_URL/refund`

capture_session_url = `YOUR_APP_URL/capture`

void_session_url = `YOUR_APP_URL/void`


# Installation Endpoint
`https://SHOPIFY_SHOP_DOMAIN/admin/oauth/authorize?client_id=YOUR_API_KEY&redirect_uri=YOUR_APP_URL/callback&state=&grant_options[]=`

**Note that `YOUR_APP_URL` needs to be a public URL hosted by Render or other cloud plarforms or local tunnel URLs like Cloudflare tunnel or ngrok .**

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

# Disclaimer
- This code is fully _unofficial_ and NOT guaranteed to pass [the public app review](https://shopify.dev/apps/store/review) for Shopify app store. The official requirements are described [here](https://shopify.dev/apps/store/requirements). 
- You need to follow [Shopi API Licene and Terms of Use](https://www.shopify.com/legal/api-terms) even for custom app usage.
- If you use this code for your production, **all resposibilties are owned by you**.



