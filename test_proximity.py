import urllib.request, json

data = json.loads(urllib.request.urlopen('http://localhost:8000/api/simulate/snapshot').read())
for sat in data['satellites']:
    conjs = sat.get('conjunctions', [])
    print(sat['id'] + ' — conjunctions: ' + str(len(conjs)))
    for c in conjs:
        print('  threat=' + c['object_b_id']
              + '  now=' + str(c['current_sep_km']) + 'km'
              + '  TCA=' + str(c['d_min_km']) + 'km'
              + '  tau=' + str(c['tau_seconds']) + 's'
              + '  violation=' + str(c['is_violation']))
