import json
import os

LOCAL_ACCEPTANCE_VERSION = 'SERA_LOCAL_REFERENCE_ACCEPTANCE_V1'


def _local_score(result, name):
    return float(result.get('localObjectives', {}).get(name, {}).get('score', 0.0))


def _priority(result, search):
    components = result.get('components', {})
    silhouette_need = 1.0 - float(components.get('silhouette', 0.0))
    body_need = 1.0 - float(components.get('bodyLandmarks', 0.0))
    face_need = 1.0 - _local_score(result, 'face')
    hair_need = 1.0 - _local_score(result, 'hair')
    need = {
        'skeleton': silhouette_need * .55 + body_need * .45,
        'arms': silhouette_need * .70 + body_need * .30,
        'legs': silhouette_need * .70 + body_need * .30,
        'costume': silhouette_need * .80 + body_need * .20,
        'face': face_need * .88 + silhouette_need * .12,
        'hair': hair_need * .88 + silhouette_need * .12,
    }
    return sorted(search.GROUPS, key=lambda group: (-need[group], group)), need


def _accept(group, candidate, current, spec, view_safe):
    if not view_safe:
        return False, 'global-view-silhouette-regression'
    cfg = spec.get('localReferenceObjective', {}).get('acceptance', {})
    search_cfg = spec.get('parameterSearch', {})
    global_min = float(search_cfg.get('minImprovement', .00030))
    local_min = float(cfg.get('localMinImprovement', .0010))
    global_tolerance = float(cfg.get('globalRegressionTolerance', .0030))
    cross_tolerance = float(cfg.get('crossLocalRegressionTolerance', .0120))
    nonlocal_face_tolerance = float(cfg.get('nonLocalFaceRegressionTolerance', .0080))
    nonlocal_hair_tolerance = float(cfg.get('nonLocalHairRegressionTolerance', .0080))

    global_delta = float(candidate.get('score', 0.0)) - float(current.get('score', 0.0))
    face_delta = _local_score(candidate, 'face') - _local_score(current, 'face')
    hair_delta = _local_score(candidate, 'hair') - _local_score(current, 'hair')

    if group == 'face':
        accepted = face_delta >= local_min and global_delta >= -global_tolerance and hair_delta >= -cross_tolerance
        reason = 'face-local-improved' if accepted else 'face-local-gate'
    elif group == 'hair':
        accepted = hair_delta >= local_min and global_delta >= -global_tolerance and face_delta >= -cross_tolerance
        reason = 'hair-local-improved' if accepted else 'hair-local-gate'
    else:
        accepted = global_delta >= global_min and face_delta >= -nonlocal_face_tolerance and hair_delta >= -nonlocal_hair_tolerance
        reason = 'global-improved-local-safe' if accepted else 'global-or-local-guard'
    return accepted, reason


def install(search):
    if getattr(search, '_sera_independent_local_objective_installed', False):
        return search

    def run_parameter_search(body, spec, reference, output_dir, render_and_score, state_path=None, cache_path=None, candidate_budget=None):
        defs = search.parameter_defs()
        cfg = spec.get('parameterSearch', {})
        seed = search.load_state(state_path, defs)
        cache = search.load_cache(cache_path)
        maxgen = max(1, int(cfg.get('maxGenerations', 6)))
        budget = max(1, int(candidate_budget or cfg.get('candidateBudget', 8)))
        regression = float(cfg.get('maxViewSilhouetteRegression', .025))
        step = max(float(cfg.get('minStep', .12)), float(cfg.get('initialStep', .62)) * float(cfg.get('stepDecay', .82)) ** seed['generation'])
        cache_limit = max(32, int(cfg.get('cacheEntries', 256)))
        snapshot = search.SceneSnapshot(body)
        by_name = {definition['name']: definition for definition in defs}
        values = dict(seed['parameters'])
        search.apply_parameter_state(snapshot, defs, values)
        objective_dir = os.path.join(output_dir, 'reference-objective')
        state_hash = search._hash(values)
        current = cache['entries'].get(state_hash)
        seed_cache_hit = current is not None and current.get('objectiveVersion') == 'REFERENCE_CROP_INDEPENDENT_FACE_HAIR_V2'
        if not seed_cache_hit:
            current = render_and_score(reference, objective_dir, f'search-local-g{seed["generation"]:02d}-seed', spec)
            search._cache_put(cache, state_hash, current, cache_limit)
        priority, need = _priority(current, search)
        history = []
        improved = 0
        generation = seed['generation']
        can_search = generation < maxgen
        if can_search:
            generation += 1
            proposals = search._proposals(defs, generation, budget, step, priority)
            for index, proposal in enumerate(proposals, 1):
                candidate_values = search._candidate(values, proposal['changes'], by_name)
                candidate_hash = search._hash(candidate_values)
                cached = cache['entries'].get(candidate_hash)
                cache_hit = cached is not None and cached.get('objectiveVersion') == 'REFERENCE_CROP_INDEPENDENT_FACE_HAIR_V2'
                search.apply_parameter_state(snapshot, defs, candidate_values)
                candidate = cached if cache_hit else render_and_score(reference, objective_dir, f'search-local-g{generation:02d}-c{index:02d}', spec)
                search._cache_put(cache, candidate_hash, candidate, cache_limit)
                view_safe = search._view_safe(candidate, current, regression)
                accepted, reason = _accept(proposal['group'], candidate, current, spec, view_safe)
                history.append({
                    'generation': generation,
                    'candidate': index,
                    'kind': proposal['kind'],
                    'group': proposal['group'],
                    'changes': proposal['changes'],
                    'stateHash': candidate_hash,
                    'globalScoreBefore': float(current.get('score', 0.0)),
                    'globalScore': float(candidate.get('score', 0.0)),
                    'globalDelta': float(candidate.get('score', 0.0)) - float(current.get('score', 0.0)),
                    'faceLocalBefore': _local_score(current, 'face'),
                    'faceLocal': _local_score(candidate, 'face'),
                    'faceLocalDelta': _local_score(candidate, 'face') - _local_score(current, 'face'),
                    'hairLocalBefore': _local_score(current, 'hair'),
                    'hairLocal': _local_score(candidate, 'hair'),
                    'hairLocalDelta': _local_score(candidate, 'hair') - _local_score(current, 'hair'),
                    'viewSafe': view_safe,
                    'accepted': accepted,
                    'acceptanceReason': reason,
                    'cacheHit': cache_hit,
                    'components': candidate.get('components', {}),
                })
                if accepted:
                    values = candidate_values
                    current = candidate
                    improved += 1
            search.apply_parameter_state(snapshot, defs, values)
        stale = 0 if improved else seed['staleGenerations'] + (1 if can_search else 0)
        continue_search = generation < maxgen and stale < int(cfg.get('maxStaleGenerations', 2))
        priority, need = _priority(current, search)
        state = {
            'version': search.STATE_VERSION,
            'schemaVersion': search.SCHEMA_VERSION,
            'parameterCount': len(defs),
            'generation': generation,
            'maxGenerations': maxgen,
            'staleGenerations': stale,
            'continueSearch': bool(continue_search),
            'score': float(current.get('score', 0.0)),
            'globalScore': float(current.get('score', 0.0)),
            'faceLocalScore': _local_score(current, 'face'),
            'hairLocalScore': _local_score(current, 'hair'),
            'components': current.get('components', {}),
            'localObjectives': current.get('localObjectives', {}),
            'objectiveVersion': current.get('objectiveVersion'),
            'groupPriority': priority,
            'groupNeed': need,
            'step': step,
            'seedLoadedFromCache': seed_cache_hit,
            'improvedCandidates': improved,
            'parameters': {key: values[key] for key in sorted(values)},
        }
        return current, state, cache, history, defs

    def write_search_outputs(out, state, cache, history, defs):
        os.makedirs(out, exist_ok=True)
        for name, data in [('sera-hero-search-state.json', state), ('sera-hero-search-cache.json', cache)]:
            with open(os.path.join(out, name), 'w', encoding='utf-8') as fp:
                json.dump(data, fp, indent=2, sort_keys=True)
                fp.write('\n')
        report = {
            'schemaVersion': search.SCHEMA_VERSION,
            'acceptanceVersion': LOCAL_ACCEPTANCE_VERSION,
            'objectiveVersion': state.get('objectiveVersion'),
            'parameterCount': len(defs),
            'groups': {group: sum(definition['group'] == group for definition in defs) for group in search.GROUPS},
            'generation': state['generation'],
            'step': state['step'],
            'improvedCandidates': state['improvedCandidates'],
            'continueSearch': state['continueSearch'],
            'bestGlobalScore': state['globalScore'],
            'bestFaceLocalScore': state['faceLocalScore'],
            'bestHairLocalScore': state['hairLocalScore'],
            'groupPriority': state['groupPriority'],
            'history': history,
            'activeParameters': state['parameters'],
        }
        with open(os.path.join(out, 'sera-hero-search-report.json'), 'w', encoding='utf-8') as fp:
            json.dump(report, fp, indent=2, sort_keys=True)
            fp.write('\n')
        return report

    search.run_parameter_search = run_parameter_search
    search.write_search_outputs = write_search_outputs
    search._sera_independent_local_objective_installed = True
    return search
