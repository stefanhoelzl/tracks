#!/usr/bin/env python3
"""A recorded ride as a GPX, for ride-measure.sh --gpx and the desktop harness's --gpx: the real ride, at its real
length, where the bundled ride is 179 points. Reads the deployed database with its read-only token:

    secrets-env -- app/iosApp/activity-gpx.py <activity-id> <out.gpx>

The ride's track is stored as three encodings (Polyline at precision 6, and TrackCodec's scalars for the times and
altitudes); the decoders below are ports of Polyline.decode and TrackCodec.decodeScalars.
"""
import datetime
import json
import os
import pathlib
import sys
import urllib.request


def decode_polyline(s, precision=6):
    factor = 10 ** precision
    out, index, lat, lon = [], 0, 0, 0
    while index < len(s):
        for which in range(2):
            result, shift = 0, 0
            while True:
                b = ord(s[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if (result & 1) else (result >> 1)
            if which == 0: lat += delta
            else: lon += delta
        out.append((lat / factor, lon / factor))
    return out

def decode_scalars(s):
    values, previous, index = [], 0, 0
    while index < len(s):
        result, shift = 0, 0
        while True:
            b = ord(s[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        if (result & 1) == 1:          # ABSENT
            values.append(None)
            continue
        zigzag = result >> 1
        previous += ~(zigzag >> 1) if (zigzag & 1) else (zigzag >> 1)
        values.append(previous)
    return values


def fetch(activity_id):
    host = os.environ['TRACKS_DB_URL'].replace('libsql://', 'https://').rstrip('/')
    sql = ('select title, started_at, track_geometry, track_altitudes, track_times from activities where id = ?')
    body = {'requests': [{'type': 'execute', 'stmt': {'sql': sql, 'args': [{'type': 'integer', 'value': str(activity_id)}]}},
                         {'type': 'close'}]}
    request = urllib.request.Request(f'{host}/v2/pipeline', data=json.dumps(body).encode(), headers={
        'Authorization': f'Bearer {os.environ["TRACKS_DB_TOKEN"]}', 'Content-Type': 'application/json'})
    result = json.load(urllib.request.urlopen(request))['results'][0]['response']['result']
    if not result['rows']:
        sys.exit(f'no activity {activity_id}')
    cols = [c['name'] for c in result['cols']]
    return dict(zip(cols, [c.get('value') for c in result['rows'][0]]))


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    row, dest = fetch(sys.argv[1]), pathlib.Path(sys.argv[2])
    points = decode_polyline(row['track_geometry'], 6)
    times = decode_scalars(row['track_times'])
    alts = [None if v is None else v / 10.0 for v in decode_scalars(row['track_altitudes'])]
    start = datetime.datetime.fromisoformat(row['started_at'].replace('Z', '+00:00'))
    assert len(points) == len(times) == len(alts), (len(points), len(times), len(alts))
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<gpx version="1.1" creator="tracks activity-gpx" xmlns="http://www.topografix.com/GPX/1/1">',
           f'  <trk><name>{row["title"]}</name><trkseg>']
    for (lat, lon), t, a in zip(points, times, alts):
        when = (start + datetime.timedelta(seconds=t)).strftime('%Y-%m-%dT%H:%M:%SZ')
        ele = f'<ele>{a:.1f}</ele>' if a is not None else ''
        out.append(f'    <trkpt lat="{lat:.6f}" lon="{lon:.6f}">{ele}<time>{when}</time></trkpt>')
    out += ['  </trkseg></trk>', '</gpx>']
    dest.write_text('\n'.join(out) + '\n')
    print(f'{dest}: {len(points)} points, {times[-1]} s, {row["title"]}')


if __name__ == '__main__':
    main()
