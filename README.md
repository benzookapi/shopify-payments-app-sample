# How to run
Just pushing to heroku with the following system variables is the easiest way to run, or npm start locally maybe.

SHOPIFY_API_KEY:              YOUR_API_KEY

SHOPIFY_API_SECRET:           YOUR_API_SECRET

SHOPIFY_API_VERSION:          2023-04

SHOPIFY_MONGO_DB_NAME:        YOUR_DB_NAME (any name is OK)

SHOPIFY_MONGO_URL:            mongodb://YOUR_ID:YOUR_PASSWORD@YOUR_DOMAIN:YOUR_PORT/YOUR_DB_NAME

SHOPIFY_JWT_SECRET:           YOUR_JWT_SECRET (any value is OK)

# Installation Endpoint
`https://SHOPIFY_SHOP_DOMAIN/admin/oauth/authorize?client_id=YOUR_API_KEY&scope=write_payment_gateways,write_payment_sessions&redirect_uri=YOUR_APP_URL/callback&state=&grant_options[]=`　

# Map your mTLS paths with payment session fields
https://shopify.dev/apps/payments/creating-a-payments-app/creating-a-payments-app#payments-app-extension-configuration-fields

Payment session URL: /payment

Refund session URL: /refund

Capture session URL: /capture

Void session URL: /void

# Map your webhook paths with GDRP webhooks
https://shopify.dev/apps/webhooks/configuration/mandatory-webhooks

customers/data_request:  /webhookgdprcustomerreq

customers/redact:  /webhookgdprcustomerdel

shop/redact:  /webhookgdprshopdel

# How to complete pending (or system error) sessions 
Use the following link.

YOUR_APP_URL/pendingcomplete?shop=SHOPIFY_SHOP_DOMAIN&id=PAYMENT_ID&kind=(sale|authorization)&action=(resolve|reject)&code=(PROCESSING_ERROR|RISKY|AUTHENTICATION_REJECTED|...)&error=ERROR_MESSAGE_FOR_REJECT

# TIPS
If you input 500 or 400 or 404 or 405 to customer's first name (given_name) in the shipping address, the app responses that HTTP error status to Shopify's session request body which prevents all following steps. 

If you input 'delay-XXX (XXX = nummeric like 10)' to customer's last name (family_name) in the shipping address, the app delay the response in that seconds to Shopify's session request body which produces an error or warning.






