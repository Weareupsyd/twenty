#!/usr/bin/env python3
"""Serve the standalone console and the checked-in Postman collection."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import argparse

REPO = Path(__file__).resolve().parent.parent
APP = Path(__file__).resolve().parent
COLLECTION = REPO / 'Evolution API - v2.3.-.postman_collection.json'


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        route = unquote(urlsplit(path).path)
        if route in ('/', '/index.html'):
            return str(APP / 'index.html')
        if route == '/collection.json':
            return str(COLLECTION)
        candidate = (APP / route.lstrip('/')).resolve()
        if candidate != APP and APP not in candidate.parents:
            return str(APP / 'index.html')
        return str(candidate)


def main() -> None:
    parser = argparse.ArgumentParser(description='Run the Evolution API standalone console')
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=4174)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f'Evolution API console ready at http://{args.host}:{args.port}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
