#!/usr/bin/env python3
"""Tiny JSON-RPC stdio MCP fixture. No network, SDK, vendor CLI or credentials."""
import json
import sys

for line in sys.stdin:
    message = json.loads(line)
    if 'id' not in message:
        continue
    method = message['method']
    if method == 'initialize':
        result = {'protocolVersion': '2024-11-05', 'capabilities': {'tools': {}},
                  'serverInfo': {'name': 'test-catalog', 'version': '0.1.0'}}
    elif method == 'tools/list':
        result = {'tools': [{'name': name, 'description': name,
                             'inputSchema': {'type': 'object', 'properties': {}}}
                            for name in ['catalog_list', 'catalog_change']]}
    elif method == 'tools/call':
        result = {'content': [{'type': 'text', 'text': json.dumps(sys.argv[1:])}]}
    else:
        print(json.dumps({'jsonrpc': '2.0', 'id': message['id'],
                          'error': {'code': -32601, 'message': 'Unknown method'}}), flush=True)
        continue
    print(json.dumps({'jsonrpc': '2.0', 'id': message['id'], 'result': result}), flush=True)
