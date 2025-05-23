'use strict';

const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const koaRequest = require('koa-http-request');
const views = require('koa-views');
const serve = require('koa-static');

const crypto = require('crypto');

const fs = require('fs');

const mongo = require('mongodb');

const jwt = require('jsonwebtoken');

const router = new Router();
const app = module.exports = new Koa();

app.use(bodyParser());

app.use(koaRequest({

}));

app.use(views(__dirname + '/views', {
  map: {
    html: 'underscore'
  }
}));

app.use(serve(__dirname + '/public'));

// Shopify API info.
const API_KEY = `${process.env.SHOPIFY_API_KEY}`;
const API_SECRET = `${process.env.SHOPIFY_API_SECRET}`;
const API_VERSION = `${process.env.SHOPIFY_API_VERSION}`

const CONTENT_TYPE_JSON = 'application/json';
const CONTENT_TYPE_FORM = 'application/x-www-form-urlencoded';

const GRAPHQL_PATH_PAYMENT = `payments_apps/api/${API_VERSION}/graphql.json`;
const GRAPHQL_PATH_ADMIN = `admin/api/${API_VERSION}/graphql.json`;

// Payment app handle
const EXTERNAL_HANDLE = 'My_Payments_App';

const UNDEFINED = 'undefined';

// Admin path signature secret
const HMAC_SECRET = API_SECRET;

// Mongo URL and DB name for date store
const MONGO_URL = `${process.env.SHOPIFY_MONGO_URL}`;
const MONGO_DB_NAME = `${process.env.SHOPIFY_MONGO_DB_NAME}`;
const MONGO_COLLECTION = 'shops';
const MONGO_COLLECTION_GROUP = 'groups';
const MONGO_COLLECTION_SESSION = 'sessions';

// JWT token secret
const JWT_SECRET = `${process.env.SHOPIFY_JWT_SECRET}`;


router.get('/', async (ctx, next) => {
  console.log("+++++++++++++++ / +++++++++++++++");
  if (!checkSignature(ctx.request.query)) {
    ctx.status = 400;
    return;
  }

  const shop = ctx.request.query.shop;

  let shop_data = null;
  try {
    shop_data = await (getDB(shop));
    let install = false;
    if (shop_data == null) {
      console.log("No shop data");
      install = true;
    } else {
      let api_res = null;
      try {
        api_res = await (callGraphql(ctx, shop, `{
        shop {
          name
        }
      }`, null, GRAPHQL_PATH_ADMIN, null));
      } catch (e) { }
      if (api_res == null || typeof api_res.data.shop.name === UNDEFINED) {
        console.log("The stored access token is invalid");
        install = true;
      }
    }
    if (install) {
      console.log(`Redirecting to OAuth flow for ${shop}...`);
      ctx.redirect(`https://${shop}/admin/oauth/authorize?client_id=${API_KEY}&scope=write_payment_gateways,write_payment_sessions&redirect_uri=https://${ctx.request.hostname}/callback&state=&grant_options[]=`);
      return;
    }
  } catch (e) {
    ctx.status = 500;
    return;
  }

  let my_key = '';
  if (typeof shop_data.config !== UNDEFINED) {
    my_key = shop_data.config.my_key;
  }

  ctx.response.set('Content-Security-Policy', `frame-ancestors https://${shop} https://admin.shopify.com;`);
  await ctx.render('index', {
    token: createJWT({
      "shop": shop
    }),
    my_key: my_key
  });

});

router.get('/callback', async (ctx, next) => {
  console.log("+++++++++++++++ /callback +++++++++++++++");
  if (!checkSignature(ctx.request.query)) {
    ctx.status = 400;
    return;
  }
  let req = {};
  req.client_id = API_KEY;
  req.client_secret = API_SECRET;
  req.code = ctx.request.query.code;

  const shop = ctx.request.query.shop;

  let res = null;
  try {
    res = await (accessEndpoint(ctx, `https://${shop}/admin/oauth/access_token`, req, null, CONTENT_TYPE_FORM));
    if (typeof res.access_token === UNDEFINED) {
      ctx.status = 500;
      return;
    }
  } catch (e) {
    ctx.status = 500;
    return;
  }

  getDB(shop).then(function (shop_data) {
    if (shop_data == null) {
      insertDB(shop, res).then(function (r) { }).catch(function (e) { });
    } else {
      setDB(shop, res).then(function (r) { }).catch(function (e) { });
    }
  }).catch(function (e) {
    ctx.status = 500;
    return;
  });

  ctx.response.set('Content-Security-Policy', `frame-ancestors https://${shop} https://admin.shopify.com;`);
  await ctx.render('index', {
    token: createJWT({
      "shop": shop
    }),
    my_key: ''
  });

});

router.get('/configure', async (ctx, next) => {
  console.log("+++++++++++++++ /configure +++++++++++++++");
  //console.log(`+++ query +++ ${JSON.stringify(ctx.request.query)}`);

  const action = ctx.request.query.action;
  const data = decodeJWT(ctx.request.query.token);
  console.log(`+++ data +++ ${JSON.stringify(data)}`);

  const shop = data.shop;

  let shop_data = null;
  try {
    shop_data = await (getDB(shop));
    if (shop_data == null) {
      ctx.body = "No shop data";
      ctx.status = 400;
      return;
    }
  } catch (e) {
    ctx.status = 500;
    return;
  }

  if (action == 'save') {
    shop_data.config = {
      "my_key": ctx.request.query.my_key
    };
    setDB(shop, shop_data).then(function (api_res) {
      callGraphql(ctx, shop, `mutation paymentsAppConfigure($externalHandle: String, $ready: Boolean!) {
        paymentsAppConfigure(externalHandle: $externalHandle, ready: $ready) {
          paymentsAppConfiguration {
            externalHandle
            ready
          }
          userErrors {
            field
            message
          }
        }
        }`, null, GRAPHQL_PATH_PAYMENT, {
        "externalHandle": EXTERNAL_HANDLE,
        "ready": true
      }).then(function (api_res) { }).catch(function (e) { });
    }).catch(function (e) { });
  }

  ctx.redirect(`https://${shop}/services/payments_partners/gateways/${API_KEY}/settings`);

});

/*
 *
 * --- mTLS handshake endpoint for initial payment processing from Shopify ---
 * 
*/
router.post('/payment', async (ctx, next) => {
  console.log("+++++++++++++++ /payment +++++++++++++++");
  console.log(`+++ headers +++ ${JSON.stringify(ctx.headers)}`);

  console.log(`+++ body +++ ${JSON.stringify(ctx.request.body)}`);

  const shop = ctx.headers["shopify-shop-domain"];
  //const request_id = ctx.headers["shopify-request-id"];
  //const version = ctx.headers["shopify-api-version"];   

  let given_name = '';
  let family_name = '';
  if (typeof ctx.request.body.customer.shipping_address !== UNDEFINED) {
    given_name = typeof ctx.request.body.customer.shipping_address.given_name !== UNDEFINED ? ctx.request.body.customer.shipping_address.given_name : given_name;
    family_name = typeof ctx.request.body.customer.shipping_address.family_name !== UNDEFINED ? ctx.request.body.customer.shipping_address.family_name : family_name;
  }
  if (given_name == '500' || given_name == '400' || given_name == '404' || given_name == '405') {
    ctx.body = "Simulated error";
    ctx.status = parseInt(given_name);
    return;
  }

  if (family_name.indexOf('delay-') != -1) {
    const time = parseInt(family_name.replace('delay-', ''));
    ctx.request.socket.setTimeout(time * 2000);
    const delay = () => { return new Promise((r) => { setTimeout(r, time * 1000) }) };
    console.log(`Starting a ${time} seconds delay...`);
    await delay();
    /*const now = Date.now();
    let temp = null;
    do {
      temp = Date.now();
    } while (temp - now < time * 1000);*/
    console.log(`The delay ended.`);
  }

  const token = createJWT({
    "headers": ctx.headers,
    "body": ctx.request.body,
    "shop": shop
  });

  console.log(`+++ token +++ ${token}`);

  ctx.body = {
    "redirect_url": `https://${ctx.request.hostname}/pay/${token}`
  }
});

router.get('/pay/:token', async (ctx, next) => {
  console.log("+++++++++++++++ /pay +++++++++++++++");
  console.log(`+++ request +++ ${JSON.stringify(ctx.request)}`);

  const token = ctx.request.url.split('/').slice(-1)[0];
  console.log(`+++ token +++ ${token}`);

  const data = decodeJWT(token);
  console.log(`+++ data +++ ${JSON.stringify(data)}`);

  const headers = data.headers;
  const body = data.body;
  const shop = data.shop;

  let shop_data = null;
  try {
    shop_data = await (getDB(shop));
    if (shop_data == null) {
      ctx.body = "No shop data";
      ctx.status = 400;
      return;
    }
  } catch (e) {
    ctx.status = 500;
    return;
  }

  await ctx.render('pay', {
    shop: shop,
    headers: headers,
    body: body,
    my_key: shop_data.config.my_key,
    cancel_url: body.payment_method.data.cancel_url,
    token: createJWT({
      "shop": shop,
      "id": body.id,
      "gid": body.gid,
      "group": body.group,
      "kind": body.kind,
      "test": body.test
    })
  });
});

router.get('/process', async (ctx, next) => {
  console.log("+++++++++++++++ /process +++++++++++++++");
  console.log(`+++ query +++ ${JSON.stringify(ctx.request.query)}`);

  const data = decodeJWT(ctx.request.query.token);
  console.log(`+++ data +++ ${JSON.stringify(data)}`);

  const shop = data.shop;
  const gid = data.gid;
  const kind = data.kind;

  // These three are possible to be overridden by the following sesion confrimation.
  let action = ctx.request.query.action;
  let code = ctx.request.query.code;
  let error = ctx.request.query.error;

  const no_redirect = ctx.request.query.no_redirect === 'true' ? true : false;

  if (action == 'resolve' || action == 'pending') {
    // Duplication check for the same group.
    const group_data = await (getDB(data.group, MONGO_COLLECTION_GROUP));
    if (group_data != null) {
      console.log(`****** A duplicated payment ${JSON.stringify(group_data)} found ******`);
      if (group_data.status == 'resolved') {
        //if the current payament is completed, do nothing.
        ctx.status = 500;
        ctx.body = `This group has been paid with ${group_data.gid}, go back to Shopify and try again.`;
        return;
      } else {
        // If other = not muted or pending, try to reject the current payment to replace with the latest one.
        await rejectPaymentSession(ctx, shop, group_data.gid, 'PROCESSING_ERROR', 'Duplicated group payment').then(function (api_res) {
          // Delete the group cache to retry the payment.
          return deleteDB(data.group, MONGO_COLLECTION_GROUP);
        }).catch(function (e) {
          console.log(`${e}`);
        });
      }
    }
    try {
      // Insert the latest group cache as a unique key (if it's duplicated, this insertion fails).
      await insertDB(data.group, { "gid": gid, "action": action, "status": "" }, MONGO_COLLECTION_GROUP);
    } catch (e) {
      ctx.status = 500;
      ctx.body = `The duplicated payments were attempted, go back to Shopify and try again.`;
      return;
    }
  }

  // Check the product inventory for overselling prevention.
  // This needs extra approval from Shopify. 
  // https://shopify.dev/docs/apps/build/payments/offsite/use-the-cli?framework=remix#explore-confirm-sessions-(closed-beta)
  const api_res = await confirmPaymentSession(ctx, shop, gid);
  if (typeof api_res.data.paymentSessionConfirm.userErrors === UNDEFINED || api_res.data.paymentSessionConfirm.userErrors.length == 0) {
    // Payment session is confirmed. Check the payment status from the cached DB set by the callback `/confirm`.
    const checkResult = async () => {
      const MAX_SECONDS = 10;
      const MAX_WAIT_TIME = MAX_SECONDS * 1000;
      const INTERVAL = 1000;
      let elapsedTime = 0;
      let session_data = null;
      return new Promise((resolve, reject) => {
        const intervalId = setInterval(async () => {
          elapsedTime += INTERVAL;

          session_data = await getDB(gid, MONGO_COLLECTION_SESSION);

          if (session_data != null) {
            clearInterval(intervalId);
            resolve(session_data);
          } else if (elapsedTime >= MAX_WAIT_TIME) {
            clearInterval(intervalId);
            reject(new Error(`Timeout: Payment session confirm result not found within ${MAX_SECONDS} seconds`));
          }
        }, INTERVAL);
      });
    };
    // Overwrite the action, code and error with the session confirmation result.
    [action, code, error] = await checkResult()
      .then(result => {
        console.log(`checkResult() - Result found: ${JSON.stringify(result)}`);
        if (typeof result.confirmation_result === UNDEFINED || result.confirmation_result == false) {
          return ['reject', 'CONFIRMATION_REJECTED', `The payment session cannot be proceeded with false confirmation like no inventory error.`];
        }
        return [action, code, error];
      })
      .catch(err => {
        return ['reject', 'CONFIRMATION_REJECTED', `The payment session was not confirmed with the error: ${err.message}`];
      });
  }

  /* ////////// DO YOUR PAYMENT PROCESS HERE ////////// */
  /* do {
     //...
   } while (true); */
  /* ////////// DO YOUR PAYMENT PROCESS HERE ////////// */
  if (action == 'resolve') {
    await resolvePaymentSession(ctx, shop, gid, kind).then(function (api_res) {
      if (typeof api_res.data.paymentSessionResolve.userErrors !== UNDEFINED && api_res.data.paymentSessionResolve.userErrors.length > 0) {
        ctx.status = 500;
        ctx.body = `The payment ${gid} was not resolved with the error: ${JSON.stringify(api_res.data.paymentSessionResolve.userErrors[0])}`;
        return;
      }
      // Set the payment status to the group cache.
      setDB(data.group, { "gid": gid, "action": action, "status": "resolved" }, MONGO_COLLECTION_GROUP);
      if (no_redirect) {
        ctx.status = 500;
        ctx.body = `The redirection to the thank you page doesn't happen with 'no_redirect' set true.`;
      } else {
        return ctx.redirect(`${api_res.data.paymentSessionResolve.paymentSession.nextAction.context.redirectUrl}`);
      }
    }).catch(function (e) {
      ctx.status = 500;
      return;
    });
  } else if (action == 'pending') {
    await setPendingPaymentSession(ctx, shop, gid).then(function (api_res) {
      if (typeof api_res.data.paymentSessionPending.userErrors !== UNDEFINED && api_res.data.paymentSessionPending.userErrors.length > 0) {
        ctx.status = 500;
        ctx.body = `The payment ${gid} was not set pending with the error: ${JSON.stringify(api_res.data.paymentSessionPending.userErrors[0])}`;
        return;
      }
      // Set the payment status to the group cache.
      setDB(data.group, { "gid": gid, "action": action, "status": "pending" }, MONGO_COLLECTION_GROUP);
      if (no_redirect) {
        ctx.status = 500;
        ctx.body = `The redirection to the thank you page doesn't happen with 'no_redirect' set true.`;
      } else {
        return ctx.redirect(`${api_res.data.paymentSessionPending.paymentSession.nextAction.context.redirectUrl}`);
      }
    }).catch(function (e) {
      ctx.status = 500;
      return;
    });
  } else if (action == 'reject') {
    await rejectPaymentSession(ctx, shop, gid, code, error).then(function (api_res) {
      if (typeof api_res.data.paymentSessionReject.userErrors !== UNDEFINED && api_res.data.paymentSessionReject.userErrors.length > 0) {
        ctx.status = 500;
        ctx.body = `The payment ${gid} was not rejected with the error: ${JSON.stringify(api_res.data.paymentSessionReject.userErrors[0])}`;
        return;
      }
      if (no_redirect) {
        ctx.status = 500;
        ctx.body = `The redirection to the thank you page doesn't happen with 'no_redirect' set true.`;
      } else {
        return ctx.redirect(`${api_res.data.paymentSessionReject.paymentSession.nextAction.context.redirectUrl}`);
      }
    }).catch(function (e) {
      ctx.status = 500;
      return;
    });
  } else {
    ctx.status = 400;
    return;
  }

});

/*
 *
 * --- mTLS handshake endpoint for refunding payment from Shopify ---
 * 
*/
router.post('/refund', async (ctx, next) => {
  console.log("+++++++++++++++ /refund +++++++++++++++");
  console.log(`+++ headers +++ ${JSON.stringify(ctx.headers)}`);
  console.log(`+++ body +++ ${JSON.stringify(ctx.request.body)}`);

  const shop = ctx.headers["shopify-shop-domain"];

  const amount = parseInt(ctx.request.body.amount);

  // 999 is a magic number for reject simulation.
  if (amount != 999) {
    // Success: Resolve the refund
    callGraphql(ctx, shop, `mutation RefundSessionResolve($id: ID!) {
      refundSessionResolve(id: $id) {
        refundSession {
          id
          state {
            ... on RefundSessionStateResolved {
             code
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`, null, GRAPHQL_PATH_PAYMENT, {
      "id": `${ctx.request.body.gid}`
    }).then(function (api_res) {

    }).catch(function (e) {
      // Error responses like ctx.status = 500 doesn't work for notifying Shopify.
    });

  } else {
    // Failure: Reject the refund
    callGraphql(ctx, shop, `mutation RefundSessionReject($id: ID!, $reason: RefundSessionRejectionReasonInput!) {
      refundSessionReject(id: $id, reason: $reason) {
       refundSession {
          id
           state {
            ... on RefundSessionStateRejected {
              code
              merchantMessage
              reason
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`, null, GRAPHQL_PATH_PAYMENT, {
      "id": `${ctx.request.body.gid}`,
      "reason": {
        "code": "PROCESSING_ERROR",
        "merchantMessage": "Reject simulation"
      }
    }).then(function (api_res) {

    }).catch(function (e) {
      // Error responses like ctx.status = 500 doesn't work for notifying Shopify.
    });
  }

  ctx.body = {}; // Shopify shows the error message unless this empty body is not sent.
  ctx.status = 201;
});

/*
 *
 * --- mTLS handshake endpoint for capturing auth. from Shopify ---
 * 
*/
router.post('/capture', async (ctx, next) => {
  console.log("+++++++++++++++ /capture +++++++++++++++");
  console.log(`+++ headers +++ ${JSON.stringify(ctx.headers)}`);
  console.log(`+++ body +++ ${JSON.stringify(ctx.request.body)}`);

  const shop = ctx.headers["shopify-shop-domain"];

  const amount = parseInt(ctx.request.body.amount);

  // 999 is a magic number for reject simulation.
  if (amount != 999) {
    // Success: Resolve the payment capture
    callGraphql(ctx, shop, `mutation CaptureSessionResolve($id: ID!) {
      captureSessionResolve(id: $id) {
        captureSession {
          id
          state {
            ... on CaptureSessionStateResolved {
              code
            }
          }
        }
        userErrors {
          code
          field
          message
        }
      }
    }`, null, GRAPHQL_PATH_PAYMENT, {
      "id": `${ctx.request.body.gid}`
    }).then(function (api_res) {

    }).catch(function (e) {
      // Error responses like ctx.status = 500 doesn't work for notifying Shopify.
    });

  } else {
    // Failure: Reject the payment capture
    callGraphql(ctx, shop, `mutation CaptureSessionReject($id: ID!, $reason: CaptureSessionRejectionReasonInput!) {
      captureSessionReject(id: $id, reason: $reason) {
        captureSession {
          id
          state {
            ... on CaptureSessionStateRejected {
              code
              reason
             merchantMessage
            }
          }
        }
        userErrors {
          code
          field
          message
        }
      }
    }`, null, GRAPHQL_PATH_PAYMENT, {
      "id": `${ctx.request.body.gid}`,
      "reason": {
        "code": "PROCESSING_ERROR",
        "merchantMessage": "Reject simulation"
      }
    }).then(function (api_res) {

    }).catch(function (e) {
      // Error responses like ctx.status = 500 doesn't work for notifying Shopify.
    });
  }

  ctx.body = {}; // Shopify shows the error message unless this empty body is not sent.
  ctx.status = 201;
});

/*
 *
 * --- mTLS handshake endpoint for voiding payment from Shopify ---
 * 
*/
router.post('/void', async (ctx, next) => {
  console.log("+++++++++++++++ /void +++++++++++++++");
  console.log(`+++ headers +++ ${JSON.stringify(ctx.headers)}`);
  console.log(`+++ body +++ ${JSON.stringify(ctx.request.body)}`);

  const shop = ctx.headers["shopify-shop-domain"];

  // Success: Resolve the void
  callGraphql(ctx, shop, `mutation VoidSessionResolve($id: ID!) {
    voidSessionResolve(id: $id) {
      voidSession {
        id
        state {
          ... on VoidSessionStateResolved {
            code
          }
        }
      }
      userErrors {
        code
        field
        message
      }
    }
  }`, null, GRAPHQL_PATH_PAYMENT, {
    "id": `${ctx.request.body.gid}`
  }).then(function (api_res) {

  }).catch(function (e) {
    // Error responses like ctx.status = 500 doesn't work for notifying Shopify.
  });

  // Failure: Reject the void
  /*callGraphql(ctx, shop, `mutation VoidSessionReject($id: ID!, $reason: VoidSessionRejectionReasonInput!) {
    voidSessionReject(id: $id, reason: $reason) {
      voidSession {
        id
        state {
          ... on VoidSessionStateRejected {
            code
            reason
            merchantMessage
          }
        }
      }
      userErrors {
        code
        field
        message
      }
    }
  }`, null, GRAPHQL_PATH_PAYMENT, {
    "id": `${ctx.request.body.gid}`,
    "reason": {
      "code": "PROCESSING_ERROR",
      "merchantMessage": error
    }
  }).then(function (api_res) { 

  }).catch(function (e) { 
    // Error responses like ctx.status = 500 doesn't work for notifying Shopify.
  });*/

  ctx.body = {}; // Shopify shows the error message unless this empty body is not sent.
  ctx.status = 201;
});

/*
 *
 * --- mTLS handshake endpoint for refunding payment from Shopify ---
 * 
*/
// https://shopify.dev/docs/apps/build/payments/offsite/use-the-cli?framework=remix#explore-confirm-sessions-(closed-beta)
router.post('/confirm', async (ctx, next) => {
  console.log("+++++++++++++++ /confirm +++++++++++++++");
  console.log(`+++ headers +++ ${JSON.stringify(ctx.headers)}`);
  console.log(`+++ body +++ ${JSON.stringify(ctx.request.body)}`);

  // Set the payment session confirmation result to the session cache.
  insertDB(ctx.request.body.gid, ctx.request.body, MONGO_COLLECTION_SESSION);

  ctx.body = {}; // Shopify shows the error message unless this empty body is not sent.
  ctx.status = 201;
});

router.get('/pendingcomplete', async (ctx, next) => {
  console.log("+++++++++++++++ /pendingcomplete +++++++++++++++");
  console.log(`+++ body +++ ${JSON.stringify(ctx.request.body)}`);

  const shop = ctx.request.query.shop;
  const gid = `gid://shopify/PaymentSession/${ctx.request.query.id}`;
  const kind = ctx.request.query.kind;

  const action = ctx.request.query.action;
  const code = ctx.request.query.code;
  const error = ctx.request.query.error;

  if (action == 'resolve') {

    await resolvePaymentSession(ctx, shop, gid, kind).then(function (api_res) {
      ctx.body = `${JSON.stringify(api_res.data, null, 2)}`;
      return;
    }).catch(function (e) {
      ctx.status = 500;
      return;
    });

  } else if (action == 'reject') {

    await rejectPaymentSession(ctx, shop, gid, code, error).then(function (api_res) {
      ctx.body = `${JSON.stringify(api_res.data, null, 2)}`;
      return;
    }).catch(function (e) {
      ctx.status = 500;
      return;
    });

  } else {
    ctx.status = 400;
    return;
  }

});

/* --- Raise a dummy system failure --- */
router.get('/failure', async (ctx, next) => {
  console.log("+++++++++++++++ /failure +++++++++++++++");
  console.log(`+++ query +++ ${JSON.stringify(ctx.request.query)}`);
  const msg = `You should try https://${ctx.request.host}/process?action=${ctx.request.query.action}&token=${ctx.request.query.token}  later for testing recovery... (Current timestamp: ${new Date().toISOString()})`;
  console.log(msg);
  ctx.status = 500;
  ctx.body = msg;

});

/* --- Resolve a payment session with Graphql --- */
const resolvePaymentSession = function (ctx, shop, gid, kind) {
  return new Promise(function (resolve, reject) {
    const variables = {
      "id": `${gid}`
    };
    let p1 = '';
    let p2 = '';
    if (kind == 'authorization') {
      variables.authorizationExpiresAt = getAuthExpired();
      p1 = ', $authorizationExpiresAt: DateTime';
      p2 = ', authorizationExpiresAt: $authorizationExpiresAt';
    }
    callGraphql(ctx, shop, `mutation paymentSessionResolve($id: ID!${p1}) {
            paymentSessionResolve(id: $id${p2}) {
              paymentSession {
                id
                state {
                  ... on PaymentSessionStateResolved {
                    code
                  }
                }
              nextAction {
                action
                context {
                  ... on PaymentSessionActionsRedirect {
                    redirectUrl
                  }
                }
              }
              }
              userErrors {
                field
                message
              }
            }
          }`, null, GRAPHQL_PATH_PAYMENT, variables).then(function (r) {
      return resolve(r);
    }).catch(function (e) {
      console.log(`${e}`);
      return reject(e);
    });
  });
};

/* --- Set a payment session pending with Graphql --- */
const setPendingPaymentSession = function (ctx, shop, gid) {
  return new Promise(function (resolve, reject) {
    callGraphql(ctx, shop, `mutation PaymentSessionPending($id: ID!, $pendingExpiresAt: DateTime!, $reason: PaymentSessionStatePendingReason!) {
      paymentSessionPending(id: $id, pendingExpiresAt: $pendingExpiresAt, reason: $reason) {
        paymentSession {
          id
          state {
            ... on PaymentSessionStatePending {
              code
              reason
            }
          }
          nextAction {
            action
            context {
              ... on PaymentSessionActionsRedirect {
                redirectUrl
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`, null, GRAPHQL_PATH_PAYMENT, {
      "id": `${gid}`,
      "pendingExpiresAt": getAuthExpired(),
      "reason": "BUYER_ACTION_REQUIRED"
    }).then(function (r) {
      return resolve(r);
    }).catch(function (e) {
      console.log(`${e}`);
      return reject(e);
    });
  });
};

/* --- Reject a payment session with Graphql --- */
const rejectPaymentSession = function (ctx, shop, gid, code, error) {
  return new Promise(function (resolve, reject) {
    callGraphql(ctx, shop, `mutation PaymentSessionReject($id: ID!, $reason: PaymentSessionRejectionReasonInput!) {
      paymentSessionReject(id: $id, reason: $reason) {
        paymentSession {
          id
          state {
            ... on PaymentSessionStateRejected {
              code
              merchantMessage
              reason
            }
          }
          nextAction {
            action
            context {
              ... on PaymentSessionActionsRedirect {
                redirectUrl
              }
           }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`, null, GRAPHQL_PATH_PAYMENT, {
      "id": `${gid}`,
      "reason": {
        "code": `${code}`,
        "merchantMessage": `${error}`
      }
    }).then(function (r) {
      return resolve(r);
    }).catch(function (e) {
      console.log(`${e}`);
      return reject(e);
    });
  });
};

/* --- Confirm a payment session with Graphql (overselling prevention) --- */
const confirmPaymentSession = function (ctx, shop, gid) {
  return new Promise(function (resolve, reject) {
    callGraphql(ctx, shop, `mutation paymentSessionConfirm($id: ID!) {
            paymentSessionConfirm(id: $id) {
              paymentSession {
                id
                state {
                  ... on PaymentSessionStateConfirming {
                    code
                  }
                }
              nextAction {
                action
                context {
                  ... on PaymentSessionActionsRedirect {
                    redirectUrl
                  }
                }
              }
              }
              userErrors {
                code
                field
                message
              }
            }
          }`, null, GRAPHQL_PATH_PAYMENT, {
      "id": `${gid}`
    }).then(function (r) {
      return resolve(r);
    }).catch(function (e) {
      console.log(`${e}`);
      return reject(e);
    });
  });
};


/* 
 * 
 * --- GDPR Webhook for customer data request ---
 * 
*/
router.post('/webhookgdprcustomerreq', async (ctx, next) => {
  console.log("*************** webhookgdprcustomerreq ***************");
  console.log(`*** body *** ${JSON.stringify(ctx.request.body)}`);

  /* Check the signature */
  const valid = await (checkWebhookSignature(ctx, API_SECRET));
  if (!valid) {
    console.log('Not a valid signature');
    ctx.status = 401;
    return;
  }

  ctx.status = 200;
});

/* 
 * 
 * --- GDPR Webhook for customer data deletion ---
 * 
*/
router.post('/webhookgdprcustomerdel', async (ctx, next) => {
  console.log("*************** webhookgdprcustomerdel ***************");
  console.log(`*** body *** ${JSON.stringify(ctx.request.body)}`);

  /* Check the signature */
  const valid = await (checkWebhookSignature(ctx, API_SECRET));
  if (!valid) {
    console.log('Not a valid signature');
    ctx.status = 401;
    return;
  }

  ctx.status = 200;
});

/* 
 * 
 * --- GDPR Webhook for shop data deletion ---
 * 
*/
router.post('/webhookgdprshopdel', async (ctx, next) => {
  console.log("*************** webhookgdprshopdel ***************");
  console.log(`*** body *** ${JSON.stringify(ctx.request.body)}`);

  /* Check the signature */
  const valid = await (checkWebhookSignature(ctx, API_SECRET));
  if (!valid) {
    console.log('Not a valid signature');
    ctx.status = 401;
    return;
  }

  ctx.status = 200;
});

/* --- Check if the given signature is correct or not --- */
const checkSignature = function (json) {
  let temp = JSON.parse(JSON.stringify(json));
  console.log(`checkSignature ${JSON.stringify(temp)}`);
  if (typeof temp.hmac === UNDEFINED) return false;
  let sig = temp.hmac;
  delete temp.hmac;
  let msg = Object.entries(temp).sort().map(e => e.join('=')).join('&');
  //console.log(`checkSignature ${msg}`);
  const hmac = crypto.createHmac('sha256', HMAC_SECRET);
  hmac.update(msg);
  let signarure = hmac.digest('hex');
  console.log(`checkSignature ${signarure}`);
  return signarure === sig ? true : false;
};

/* --- Check if the given signarure is corect or not for Webhook --- */
const checkWebhookSignature = function (ctx, secret) {
  return new Promise(function (resolve, reject) {
    console.log(`checkWebhookSignature Headers ${JSON.stringify(ctx.headers)}`);
    let receivedSig = ctx.headers["x-shopify-hmac-sha256"];
    console.log(`checkWebhookSignature Given ${receivedSig}`);
    if (receivedSig == null) return resolve(false);
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(Buffer.from(ctx.request.rawBody, 'utf8').toString('utf8'));
    let signarure = hmac.digest('base64');
    console.log(`checkWebhookSignature Created: ${signarure}`);
    return resolve(receivedSig === signarure ? true : false);
  });
};

/* --- Create JWT to pass data encoded through URL access --- */
const createJWT = function (json) {
  return jwt.sign(json, JWT_SECRET, { expiresIn: '7d' });
};

/* --- Decode JWT passed through URL access --- */
const decodeJWT = function (token) {
  return jwt.verify(token, JWT_SECRET);
};

/* --- Call Shopify GraphQL --- */
const callGraphql = function (ctx, shop, ql, token = null, path = GRAPHQL_PATH_PAYMENT, vars = null) {
  return new Promise(function (resolve, reject) {
    let api_req = {};
    // Set Gqphql string into query field of the JSON  as string
    api_req.query = ql.replace(/\n/g, '');
    if (vars != null) {
      api_req.variables = vars;
    }
    let access_token = token;
    if (access_token == null) {
      getDB(shop).then(function (shop_data) {
        if (shop_data == null) return reject(null);
        access_token = shop_data.access_token;
        accessEndpoint(ctx, `https://${shop}/${path}`, api_req, access_token).then(function (api_res) {
          return resolve(api_res);
        }).catch(function (e) {
          //console.log(`callGraphql ${e}`);
          return reject(e);
        });
      }).catch(function (e) {
        console.log(`callGraphql ${e}`);
        return reject(e);
      });
    } else {
      accessEndpoint(ctx, `https://${shop}/${path}`, api_req, access_token).then(function (api_res) {
        return resolve(api_res);
      }).catch(function (e) {
        //console.log(`callGraphql ${e}`);
        return reject(e);
      });
    }
  });
};

/* ---  HTTP access common function for GraphQL --- */
const accessEndpoint = function (ctx, endpoint, req, token = null, content_type = CONTENT_TYPE_JSON) {
  console.log(`[ accessEndpoint ] POST ${endpoint} ${JSON.stringify(req)}`);
  return new Promise(function (resolve, reject) {
    // Success callback
    let then_func = function (res) {
      console.log(`[ accessEndpoint ] Success: POST ${endpoint} ${res}`);
      return resolve(JSON.parse(res));
    };
    // Failure callback
    let catch_func = function (e) {
      console.log(`[ accessEndpoint ] Failure: POST ${endpoint} ${e}`);
      return reject(e);
    };
    let headers = {};
    headers['Content-Type'] = content_type;
    if (token != null) {
      headers['X-Shopify-Access-Token'] = token;
      // NOTE THAT currently the following three headers are neccessary for Payment App API calls as of late 2021 unlike Admin APIs.
      headers['Content-Length'] = Buffer.byteLength(JSON.stringify(req));
      headers['User-Agent'] = 'My_Payments_App';
      headers['Host'] = endpoint.split('/')[2];
    }
    console.log(`[ accessEndpoint ] ${JSON.stringify(headers)}`);
    ctx.post(endpoint, req, headers).then(then_func).catch(catch_func);
  });
};

/* --- Store Shopify data in database --- */
const insertDB = function (key, data, collection = MONGO_COLLECTION) {
  return new Promise(function (resolve, reject) {
    mongo.MongoClient.connect(MONGO_URL).then(function (db) {
      //console.log(`insertDB Connected: ${MONGO_URL}`);
      var dbo = db.db(MONGO_DB_NAME);
      console.log(`insertDB Used: ${MONGO_DB_NAME} - ${collection}`);
      console.log(`insertDB insertOne, _id:${key}`);
      dbo.collection(collection).insertOne({ "_id": key, "data": data, "created_at": new Date(), "updated_at": new Date() }).then(function (res) {
        db.close();
        return resolve(0);
      }).catch(function (e) {
        console.log(`insertDB Error ${e}`);
        return reject(e);
      });
    }).catch(function (e) {
      console.log(`insertDB Error ${e}`);
      return reject(e);
    });
  });
};

/* --- Retrive Shopify data in database --- */
const getDB = function (key, collection = MONGO_COLLECTION) {
  return new Promise(function (resolve, reject) {
    console.log(`getDB MONGO_URL ${MONGO_URL}`);
    mongo.MongoClient.connect(MONGO_URL).then(function (db) {
      //console.log(`getDB Connected ${MONGO_URL}`);
      var dbo = db.db(MONGO_DB_NAME);
      console.log(`getDB Used ${MONGO_DB_NAME} - ${collection}`);
      console.log(`getDB findOne, _id:${key}`);
      dbo.collection(collection).findOne({ "_id": `${key}` }).then(function (res) {
        db.close();
        if (res == null) return resolve(null);
        return resolve(res.data);
      }).catch(function (e) {
        console.log(`getDB Error ${e}`);
        return reject(e);
      });
    }).catch(function (e) {
      console.log(`getDB Error ${e}`);
      return reject(e);
    });
  });
};

/* --- Update Shopify data in database --- */
const setDB = function (key, data, collection = MONGO_COLLECTION) {
  return new Promise(function (resolve, reject) {
    mongo.MongoClient.connect(MONGO_URL).then(function (db) {
      //console.log(`setDB Connected ${MONGO_URL}`);
      var dbo = db.db(MONGO_DB_NAME);
      console.log(`setDB Used ${MONGO_DB_NAME} - ${collection}`);
      console.log(`setDB findOneAndUpdate, _id:${key}`);
      dbo.collection(collection).findOneAndUpdate({ "_id": `${key}` }, { $set: { "data": data, "updated_at": new Date() } }, { new: true }).then(function (res) {
        db.close();
        return resolve(res);
      }).catch(function (e) {
        console.log(`setDB Error ${e}`);
        return reject(e);
      });
    }).catch(function (e) {
      console.log(`setDB Error ${e}`);
      return reject(e);
    });
  });
};

/* --- Delete Shopify data in database --- */
const deleteDB = function (key, collection = MONGO_COLLECTION) {
  return new Promise(function (resolve, reject) {
    mongo.MongoClient.connect(MONGO_URL).then(function (db) {
      //console.log(`setDB Connected ${MONGO_URL}`);
      var dbo = db.db(MONGO_DB_NAME);
      console.log(`deleteDB Used ${MONGO_DB_NAME} - ${collection}`);
      console.log(`deleteDB deleteOne, _id:${key}`);
      dbo.collection(collection).deleteOne({ "_id": `${key}` }).then(function (res) {
        db.close();
        return resolve(res);
      }).catch(function (e) {
        console.log(`deleteDB Error ${e}`);
        return reject(e);
      });
    }).catch(function (e) {
      console.log(`deleteDB Error ${e}`);
      return reject(e);
    });
  });
};

/* --- Calculate auth. and pending expiration date. --- */
const getAuthExpired = function () {
  const now = new Date();
  now.setDate(now.getDate() + 1); // You can change the number of days.
  return now.toISOString();
}

app.use(router.routes());
app.use(router.allowedMethods());

if (!module.parent) app.listen(process.env.PORT || 3000);