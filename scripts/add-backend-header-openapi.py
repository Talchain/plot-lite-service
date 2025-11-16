#!/usr/bin/env python3
"""
Add X-Olumi-Backend header to all /v1/* endpoints in OpenAPI spec
"""
import yaml
import sys

def add_backend_header(spec):
    """Add X-Olumi-Backend to all /v1/* POST endpoints' 200 responses"""
    paths = spec.get('paths', {})
    modified = 0
    
    for path, methods in paths.items():
        if not path.startswith('/v1/'):
            continue
            
        post = methods.get('post')
        if not post:
            continue
            
        responses = post.get('responses', {})
        response_200 = responses.get('200')
        
        if not response_200:
            continue
            
        headers = response_200.get('headers', {})
        
        # Add X-Olumi-Backend if not present
        if 'X-Olumi-Backend' not in headers:
            headers['X-Olumi-Backend'] = {
                'description': 'Active backend mode (fallback or scm_lite)',
                'schema': {'type': 'string', 'enum': ['fallback', 'scm_lite']}
            }
            response_200['headers'] = headers
            modified += 1
            print(f"✓ Added X-Olumi-Backend to {path}")
    
    return modified

def main():
    openapi_path = 'contracts/openapi.yaml'
    
    # Load YAML
    with open(openapi_path, 'r') as f:
        spec = yaml.safe_load(f)
    
    # Add headers
    count = add_backend_header(spec)
    
    # Save YAML
    with open(openapi_path, 'w') as f:
        yaml.dump(spec, f, default_flow_style=False, sort_keys=False, width=120)
    
    print(f"\n✅ Modified {count} endpoints")
    return 0

if __name__ == '__main__':
    sys.exit(main())
