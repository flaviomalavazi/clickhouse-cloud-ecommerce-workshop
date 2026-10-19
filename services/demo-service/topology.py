"""POST contracts for the compact observable e-commerce service graph."""

TOPOLOGY = {
    "storefront-bff": {
        "routes": {
            "/v1/journeys/catalog": {"response": {"journey": "catalog"}, "downstreams": [{"role": "catalog-svc", "path": "/v1/catalog/view"}]},
            "/v1/journeys/checkout/start": {"response": {"journey": "checkout-start"}, "downstreams": [{"role": "checkout-svc", "path": "/v1/start"}]},
            "/v1/journeys/checkout/card": {"response": {"journey": "checkout-card"}, "downstreams": [{"role": "checkout-svc", "path": "/v1/card"}]},
            "/v1/journeys/checkout/pix": {"response": {"journey": "checkout-pix"}, "downstreams": [{"role": "checkout-svc", "path": "/v1/pix"}]},
            "/v1/journeys/checkout/boleto": {"response": {"journey": "checkout-boleto"}, "downstreams": [{"role": "checkout-svc", "path": "/v1/boleto"}]},
            "/v1/journeys/order": {"response": {"journey": "order"}, "downstreams": [{"role": "checkout-svc", "path": "/v1/order"}]},
        },
    },
    "catalog-svc": {
        "routes": {
            "/v1/catalog/view": {"response": {"catalog": "view"}, "downstreams": []},
        },
    },
    "checkout-svc": {
        "routes": {
            "/v1/start": {"response": {"checkout": "started"}, "downstreams": [{"role": "pricing-svc", "path": "/v1/quote"}, {"role": "inventory-svc", "path": "/v1/check"}]},
            "/v1/card": {"response": {"checkout": "card"}, "downstreams": [{"role": "payment-card-svc", "path": "/v1/authorize"}]},
            "/v1/pix": {"response": {"checkout": "pix"}, "stages": [[{"role": "payment-pix-svc", "path": "/v1/create"}], [{"role": "order-svc", "path": "/v1/orders"}]]},
            "/v1/boleto": {"response": {"checkout": "boleto"}, "stages": [[{"role": "payment-boleto-svc", "path": "/v1/create"}], [{"role": "order-svc", "path": "/v1/orders"}]]},
            "/v1/order": {"response": {"checkout": "order"}, "downstreams": [{"role": "order-svc", "path": "/v1/orders"}]},
        },
    },
    "pricing-svc": {"routes": {"/v1/quote": {"response": {"quote": "ready"}, "downstreams": []}}},
    "inventory-svc": {"routes": {"/v1/check": {"response": {"inventory": "available"}, "downstreams": []}}},
    "payment-card-svc": {
        "routes": {
            "/v1/authorize": {"response": {"payment": "card-authorized"}, "downstreams": [{"role": "card-gateway", "path": "/v1/authorize"}]},
        },
    },
    "card-gateway": {"routes": {"/v1/authorize": {"response": {"payment": "gateway-authorized"}, "downstreams": []}}},
    "payment-pix-svc": {
        "routes": {"/v1/create": {"response": {"payment": "pix-created"}, "downstreams": [{"role": "pix-psp-gateway", "path": "/v1/create"}]}},
    },
    "pix-psp-gateway": {"routes": {"/v1/create": {"response": {"pix": "created"}, "downstreams": []}}},
    "payment-boleto-svc": {
        "routes": {"/v1/create": {"response": {"payment": "boleto-created"}, "downstreams": [{"role": "boleto-gateway", "path": "/v1/create"}]}},
    },
    "boleto-gateway": {"routes": {"/v1/create": {"response": {"boleto": "created"}, "downstreams": []}}},
    "order-svc": {
        "routes": {
            "/v1/orders": {"response": {"order": "created"}, "downstreams": [{"role": "ledger-svc", "path": "/v1/entries"}, {"role": "email-gateway", "path": "/v1/send", "optional": True}]},
        },
    },
    "ledger-svc": {"routes": {"/v1/entries": {"response": {"ledger": "recorded"}, "downstreams": []}}},
    "email-gateway": {"routes": {"/v1/send": {"response": {"email": "sent"}, "downstreams": []}}},
}
