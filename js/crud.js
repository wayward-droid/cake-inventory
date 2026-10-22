// ---------------------------------------------------------------------------
// Generic list + form + soft-delete engine for simple entities.
// A module declares a spec; this file does the rest.
// ---------------------------------------------------------------------------

import { sb, errText, dataChanged } from './supabase.js';
import {
  esc, money, fmtDate, titleCase, emptyState, table, pager, toast, confirmDialog,
  formModal, openModal, spinner, icon, badge, setBusy, exportModal,
} from './ui.js';

export function defineCrudModule(spec) {
  return {
    async render(root, params, ctx) {
      await renderCrud(root, spec, ctx);
    },
  };
}

async function renderCrud(root, spec, ctx) {
  const { profile, isOwner } = ctx;
  const canWrite = !spec.ownerOnly || isOwner;
  const pageSize = spec.pageSize || 25;
  const state = {
    rows: [],
    total: 0,
    page: 1,
    search: '',
    filters: {},
    loading: true,
    lookups: {},
  };

  root.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">${esc(spec.eyebrow || 'Catalogue')}</p>
        <h1>${esc(spec.title)}</h1>
        <p class="page-sub">${esc(spec.subtitle || '')}</p>
      </div>
      <div class="page-actions">
        ${spec.exportable ? `<button class="btn btn--ghost" data-export>${icon('download', 17)} Export</button>` : ''}
        ${canWrite ? `<button class="btn btn--primary" data-new>${icon('plus', 17)} New ${esc(spec.singular || 'record')}</button>` : ''}
      </div>
    </div>
    ${!canWrite ? `<div class="notice">${icon('lock', 17)} Read-only. Only the owner can add or change ${esc(spec.title.toLowerCase())}.</div>` : ''}
    <div id="crud-summary"></div>
    <section class="card">
      <div class="toolbar">
        <div class="search-box">
          ${icon('search', 17)}
          <input type="search" placeholder="${esc(spec.searchPlaceholder || `Search ${spec.title.toLowerCase()}…`)}" data-search>
        </div>
        <div class="toolbar__filters">
          ${(spec.filters || []).map((f) => `
            <select data-filter="${esc(f.name)}" aria-label="${esc(f.label)}">
              <option value="">${esc(f.label)}: all</option>
              ${(f.options || []).map((o) => `<option value="${esc(o.value ?? o)}">${esc(o.label ?? titleCase(o))}</option>`).join('')}
            </select>`).join('')}
          <button class="icon-btn" data-refresh title="Refresh">${icon('refresh', 17)}</button>
        </div>
      </div>
      <div id="crud-table">${spinner()}</div>
      <div id="crud-pager"></div>
    </section>`;

  const tableEl = root.querySelector('#crud-table');
  const pagerEl = root.querySelector('#crud-pager');
  const summaryEl = root.querySelector('#crud-summary');

  // ------------------------------------------------------------------ lookups
  async function loadLookups() {
    const sources = new Map();
    for (const f of spec.fields || []) {
      if (f.optionsFrom) sources.set(f.optionsFrom.table, f.optionsFrom);
    }
    for (const [table, cfg] of sources) {
      const { data, error } = await sb.from(table).select('*').order(cfg.order || cfg.label || 'name');
      if (error) throw new Error(errText(error));
      state.lookups[table] = data || [];
    }
    for (const [table, cfg] of Object.entries(spec.lookups || {})) {
      const { data, error } = await sb.from(table).select('*').order(cfg.order || cfg.label || 'name');
      if (error) throw new Error(errText(error));
      state.lookups[table] = data || [];
    }
  }

  function optionsFor(field) {
    if (field.options) return field.options;
    const cfg = field.optionsFrom;
    if (!cfg) return [];
    return (state.lookups[cfg.table] || []).map((r) => ({
      value: r[cfg.value || 'id'],
      label: r[cfg.label || 'name'],
    }));
  }

  function lookupLabel(table, id, label = 'name') {
    const row = (state.lookups[table] || []).find((r) => r.id === id);
    return row?.[label] ?? '—';
  }

  // ------------------------------------------------------------------ load
  async function load() {
    state.loading = true;
    tableEl.innerHTML = spinner();
    try {
      let query = sb.from(spec.table).select('*', { count: 'exact' });
      if (spec.softDelete !== false) query = query.is('deleted_at', null);
      for (const [key, val] of Object.entries(state.filters)) {
        if (val !== '' && val != null) query = query.eq(key, val);
      }
      if (state.search && (spec.searchFields || []).length) {
        const term = state.search.replace(/[%,]/g, ' ');
        query = query.or(spec.searchFields.map((f) => `${f}.ilike.%${term}%`).join(','));
      }
      const order = spec.order || { column: 'created_at', ascending: false };
      query = query.order(order.column, { ascending: order.ascending !== false });
      const from = (state.page - 1) * pageSize;
      query = query.range(from, from + pageSize - 1);

      const { data, error, count } = await query;
      if (error) throw new Error(errText(error));
      state.rows = data || [];
      state.total = count ?? state.rows.length;
      renderTable();
      if (spec.onLoad) await spec.onLoad({ rows: state.rows, root, lookups: state.lookups, summaryEl, reload: load });
    } catch (e) {
      tableEl.innerHTML = `<div class="notice notice--danger">${icon('alert', 17)} ${esc(e.message)}</div>`;
    } finally {
      state.loading = false;
    }
  }

  function renderTable() {
    const actions = canWrite && (spec.rowActions || []).length
      ? [{ key: '__actions' }]
      : (canWrite && spec.deletable !== false ? [{ key: '__actions' }] : []);
    const columns = [...spec.columns, ...actions.map(() => ({
      key: '__actions',
      label: '',
      className: 'td-actions',
      raw: true,
      render: (row) => rowActionsHTML(row),
    }))];

    const rows = state.rows;
    tableEl.innerHTML = table({
      columns,
      rows,
      empty: spec.emptyText || `No ${spec.title.toLowerCase()} yet.`,
      onRowAttrs: (row) => {
        if (!spec.rowHref) return '';
        return `data-href="${esc(spec.rowHref(row))}" tabindex="0" style="cursor:pointer"`;
      },
    });

    tableEl.querySelectorAll('tbody tr[data-href]').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        ctx.navigate(tr.dataset.href);
      });
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') ctx.navigate(tr.dataset.href);
      });
    });

    tableEl.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const row = rows.find((r) => r.id === btn.dataset.id);
        if (!row) return;
        const key = btn.dataset.action;
        if (key === 'edit') return openForm(row);
        if (key === 'delete') return removeRow(row);
        const action = (spec.rowActions || []).find((a) => a.key === key);
        if (!action) return;
        setBusy(btn, true);
        try {
          const done = await action.run(row, {
            reload: load, ctx, lookups: state.lookups, openModal, toast, confirmDialog,
          });
          if (done !== false) await load();
        } catch (err) {
          toast(err.message || String(err), 'error');
        } finally {
          setBusy(btn, false);
        }
      });
    });

    pagerEl.innerHTML = pager(state.page, state.total, pageSize);
    pagerEl.querySelectorAll('[data-page]').forEach((b) => {
      b.onclick = () => { state.page = Number(b.dataset.page); load(); };
    });
  }

  function rowActionsHTML(row) {
    const custom = canWrite ? (spec.rowActions || []).filter((a) => !a.show || a.show(row, { isOwner })) : [];
    if (!canWrite) return '<span class="muted">—</span>';
    return `<div class="row-actions">
      ${custom.map((a) => `<button class="btn btn--sm btn--ghost" data-action="${esc(a.key)}" data-id="${esc(row.id)}" title="${esc(a.title || a.label)}">${a.icon ? icon(a.icon, 15) : ''}<span>${esc(a.label)}</span></button>`).join('')}
      ${spec.editable === false ? '' : `<button class="icon-btn" data-action="edit" data-id="${esc(row.id)}" title="Edit">${icon('edit', 16)}</button>`}
      ${spec.deletable === false ? '' : `<button class="icon-btn icon-btn--danger" data-action="delete" data-id="${esc(row.id)}" title="Archive">${icon('trash', 16)}</button>`}
    </div>`;
  }

  // ------------------------------------------------------------------ form
  function formFields(mode) {
    return (spec.fields || []).filter((f) => {
      if (mode === 'create' && f.hideOnCreate) return false;
      if (mode === 'edit' && (f.createOnly || f.hideOnEdit)) return false;
      return true;
    });
  }

  function openForm(row = null) {
    const mode = row ? 'edit' : 'create';
    const values = row ? { ...row } : { ...(spec.defaults || {}) };
    formModal({
      title: row ? `Edit ${spec.singular || 'record'}` : `New ${spec.singular || 'record'}`,
      fields: formFields(mode).map((f) => ({ ...f, options: optionsFor(f) })),
      values,
      wide: spec.formWide,
      submitLabel: row ? 'Save changes' : 'Create',
      extraFooter: row && spec.extraFormFooter ? spec.extraFormFooter(row, ctx) : '',
      onSubmit: async (data) => {
        const payload = { ...data };
        const files = [];
        for (const f of formFields(mode)) {
          if (f.type === 'file') {
            if (payload[f.name]) files.push({ field: f.name, file: payload[f.name] });
            delete payload[f.name];
          }
          if (f.createOnly) delete payload[f.name];
          if (f.readonly) delete payload[f.name];
        }
        if (spec.beforeSave) await spec.beforeSave(payload, { mode, row, ctx });
        let saved;
        if (mode === 'create') {
          const { data: inserted, error } = await sb.from(spec.table).insert(payload).select().single();
          if (error) throw new Error(errText(error));
          saved = inserted;
        } else {
          const { data: updated, error } = await sb.from(spec.table).update(payload).eq('id', row.id).select().single();
          if (error) throw new Error(errText(error));
          saved = updated;
        }
        if (files.length && spec.attachmentsEntity) {
          for (const { file } of files) {
            const path = `${spec.attachmentsEntity}/${saved.id}/${Date.now()}-${file.name.replace(/\s+/g, '-')}`;
            const { error: upErr } = await sb.storage.from('cake-files').upload(path, file);
            if (upErr) throw new Error(`File upload failed: ${errText(upErr)}`);
            const { error: attErr } = await sb.from('attachments').insert({
              entity: spec.attachmentsEntity, entity_id: saved.id, file_path: path,
              file_name: file.name, mime_type: file.type, size_bytes: file.size,
            });
            if (attErr) throw new Error(errText(attErr));
          }
        }
        if (spec.onAfterSave) await spec.onAfterSave(saved, data, mode, row, { ctx });
        dataChanged(spec.table);
        toast(`${spec.singular || 'Record'} ${mode === 'create' ? 'created' : 'updated'}.`);
        await load();
        if (spec.afterSaveNavigate && mode === 'create') ctx.navigate(spec.afterSaveNavigate(saved));
      },
    });
  }

  async function removeRow(row) {
    const ok = await confirmDialog({
      title: `Archive this ${spec.singular || 'record'}?`,
      message: spec.deleteMessage || 'It will disappear from lists but remain in history and reports. The owner can restore it from Admin → Trash.',
      confirmText: 'Archive',
      danger: true,
    });
    if (!ok) return;
    try {
      if (spec.softDelete === false) {
        const { error } = await sb.from(spec.table).delete().eq('id', row.id);
        if (error) throw new Error(errText(error));
      } else {
        const { error } = await sb.from(spec.table).update({ deleted_at: new Date().toISOString() }).eq('id', row.id);
        if (error) throw new Error(errText(error));
      }
      dataChanged(spec.table);
      toast('Archived.');
      await load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ------------------------------------------------------------------ bind
  root.querySelector('[data-new]')?.addEventListener('click', () => openForm(null));
  root.querySelector('[data-refresh]')?.addEventListener('click', load);
  root.querySelector('[data-export]')?.addEventListener('click', async () => {
    try {
      const { data, error } = await sb.from(spec.table).select('*');
      if (error) throw new Error(errText(error));
      const exportColumns = spec.columns
        .filter((c) => c.key)
        .map((c) => ({ key: c.key, label: c.label, value: c.value, className: c.className }));
      exportModal({
        title: spec.title,
        filename: `${spec.table}-${new Date().toISOString().slice(0, 10)}`,
        rows: data || [],
        columns: exportColumns,
        meta: `${spec.title} · ${new Date().toLocaleDateString('en-NG')}`,
      });
    } catch (e) { toast(e.message, 'error'); }
  });

  let searchTimer;
  root.querySelector('[data-search]')?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = e.target.value.trim();
      state.page = 1;
      load();
    }, 260);
  });

  root.querySelectorAll('[data-filter]').forEach((sel) => {
    sel.addEventListener('change', () => {
      state.filters[sel.dataset.filter] = sel.value;
      state.page = 1;
      load();
    });
  });

  try {
    await loadLookups();
  } catch (e) {
    tableEl.innerHTML = `<div class="notice notice--danger">${icon('alert', 17)} ${esc(e.message)}</div>`;
    return;
  }
  await load();
}

// ---------------------------------------------------------------------------
// Shared helpers used by custom modules
// ---------------------------------------------------------------------------
export function lookupMap(rows, key = 'id') {
  return new Map((rows || []).map((r) => [r[key], r]));
}

export function optionRows(rows, valueKey = 'id', labelKey = 'name') {
  return (rows || []).map((r) => ({ value: r[valueKey], label: r[labelKey] }));
}
