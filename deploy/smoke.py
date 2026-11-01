#!/usr/bin/env python3
"""Read-only HTTP checks for a local preview or deployed catalog."""
import json, re, sys, time
from urllib.request import urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode, quote
from xml.etree import ElementTree
site = sys.argv[1].rstrip('/')
api = (sys.argv[2] if len(sys.argv)>2 else site).rstrip('/')
checks = []
def get(base, route, parse=True):
    start=time.monotonic()
    with urlopen(base+route,timeout=40) as response:
        body=response.read().decode();status=response.status
    checks.append({'route':route,'status':status,'ms':round((time.monotonic()-start)*1000,1)})
    return json.loads(body) if parse else body
def search(**params): return get(api,'/api/catalog/search?'+urlencode(params))
status=get(api,'/api/catalog/status'); assert status['current_offers']>0 and status['identity_version']=='sku-v2'
for query in ('ferveks','magnezijum citrat','magnezijum bisglicinat','pampers premium care 4'):
    page=search(q=query,limit=10);assert page['total_groups']>0,query
    for group in page['groups']:
        title=group['normalized_name'].lower()
        if query=='ferveks': assert 'fervex' in title and page['corrected_query']=='fervex'
        if query.endswith(' citrat'):assert 'citr' in title
        if query.endswith(' bisglicinat'):assert 'bisg' in title
        if query.endswith('care 4'):assert re.search(r'\b4\b',title),title
zinc=search(q='cink',brand='Solgar',limit=10);assert zinc['groups']
assert all(g['brand']=='Solgar' for g in zinc['groups'])
group=zinc['groups'][0];ident=quote(group['id'],safe='')
detail=get(api,'/api/catalog/skus/'+ident)['group']
assert detail['price_range']==group['price_range'] and detail['details_complete']
assert len(detail['products'])==detail['vendor_count']
assert abs(min(p['price'] for p in detail['products'])-detail['price_range']['min'])<.001
paged=search(q='magnezijum',limit=2)
next_page=search(q='magnezijum',limit=2,cursor=paged['next_cursor'])
assert not set(g['id'] for g in paged['groups']) & set(g['id'] for g in next_page['groups'])
for invalid in ('limit=oops','offset=-1','minPrice=NaN','maxPrice=Infinity','quantity=bad'):
    try: get(api,'/api/catalog/search?'+invalid); raise AssertionError('Invalid request accepted: '+invalid)
    except HTTPError as e: assert e.code==400,(invalid,e.code)
html=get(site,'/',False);assert 'lang="sr-Latn"' in html and '<h1' in html and 'googletagmanager.com' not in html
html=get(site,'/proizvod/'+ident,False)
structured=re.search(r'<script type="application/ld\+json">(.*?)</script>',html)
assert structured and json.loads(structured.group(1))['@type']=='Product'
assert 'canonical' in html and '/proizvod/' in html
assert '<h1' in get(site,'/srodni/'+quote(group['family_id'],safe=''),False)
try: get(site,'/proizvod/not-a-product',False); raise AssertionError('Missing product did not return 404')
except HTTPError as e: assert e.code==404
category=get(site,'/kategorija/suplementi-i-vitamini?page=2',False)
assert 'https://aposteka.rs/kategorija/suplementi-i-vitamini?page=2' in category
robots=get(site,'/robots.txt',False);assert 'Sitemap:' in robots and '/profil' in robots
ElementTree.fromstring(get(site,'/sitemap.xml',False))
chunk=ElementTree.fromstring(get(site,'/sitemaps/0.xml',False));assert len(chunk)>0
with urlopen(site+'/images/pharmacy-hero.png',timeout=20) as response:
    assert response.status==200 and response.headers.get_content_type().startswith('image/')
print(json.dumps({'passed':True,'catalog':{k:status[k] for k in ('catalog_version','build_version','dictionary_version','offers','skus','current_offers','current_skus')},'product_id':group['id'],'checks':checks},indent=2))
