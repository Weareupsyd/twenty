# Evolution API Console

A standalone API console powered by the checked-in `Evolution API - v2.3.-.postman_collection.json` collection. It is separate from the Protecta Bode CRM app and sends requests to a remote Evolution API server (it does not install or host Evolution API).

## Run

From the repository root:

```bash
python3 evolution-api-console/server.py --port 4174
```

Open `http://localhost:4174`. In the Arena preview, the console is available from the preview for port 4174.

The console loads the Postman collection and exposes its grouped endpoints, request methods, URL variables, and example bodies. Configure the remote base URL, instance name, and global API key in **Connection settings**. Select any request in the collection and send it. The WhatsApp quick-send card calls the collection's `POST /message/sendText/{instance}` endpoint.

## Notes

- The global key is sent as the `apikey` HTTP header, matching the collection's API-key authorization.
- Requests are made directly from this browser to the configured Evolution server. Configure CORS on that remote server to allow the console's origin.
- Connection settings and API key are stored in this browser's `localStorage`. Use only in a trusted browser; do not deploy this as a shared production client without adding a secured backend proxy.
- Use the instance and API key from your existing remote Evolution API deployment. This console will not create or manage your Evolution server for you.
