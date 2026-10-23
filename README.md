# 🍰 Cake Slice Factory

A live sales, inventory, production and expense system for a cake business.
**Stack:** plain HTML + CSS + JavaScript (ES modules, no build step) + Supabase
(Postgres, Auth, RLS, Storage).

> **Project documents**
> - 📋 [Product Requirements Document](docs/PRD.md) — requirements, features, rules, release plan
> - 🏗️ [Design Architecture](docs/ARCHITECTURE.md) — components, data model, security, flows, ADRs
> - 🗣️ [Live Pitch and Responsibilities](docs/Cake%20Slice%20Factory%20-%20Live%20Pitch%20and%20Responsibilities.docx) — plain-English pitch and component map

---

## Quick start (live Supabase)

The app reads and writes a real Supabase project. Configure the connection before signing in.

1. **Create a project** at <https://supabase.com>.
2. **Run the SQL, in order**, in *SQL Editor*:
   1. `supabase/schema.sql` — base schema, triggers, functions, views and RLS.
   2. `supabase/002_core_additions.sql` — audit log, purchase orders, stock takes,
      notifications, immutability, extra views and policies.
   3. `supabase/003_owner_setup.sql` — first-run owner claim (safe to rerun).
   4. `supabase/004_website_catalogue.sql` — adds the **Website** channel and imports
      the live menu from <https://thecakeslicefactory.com/> (86 products across budget
      cakes, cake slices, milk cakes, cake in a jar, banana bread and fruit juice).
      It is safe to rerun; it updates names, categories and prices without resetting
      stock, type or status already adjusted in the app.

   If a run is interrupted, fix the reported issue and rerun the whole file from the top.
   All migrations are written to be safe to re-run.
3. **Copy your keys:** *Project Settings → API* → Project URL + `anon` public key.
4. **Edit `js/config.js`**:
   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ...';
   ```
   The anon key is public by design. Never put a service-role key in this file.
5. **Serve the app**:
   ```bash
   node tools/serve.js
   # open http://localhost:5173
   ```
   ES modules and Supabase auth redirects need an `http://` origin, so do not open
   `index.html` directly from disk.
6. **Create the owner account** on the sign-in page: choose **Create owner account**.
   The first account claims ownership automatically. If email confirmation is enabled,
   confirm the email, then sign in with the same details and setup finishes.
7. **Add staff** by letting them sign up normally (they start as `staff`), then promote
   them in **Admin → Users & roles**. The SQL fallback is:
   ```sql
   select public.promote_to_owner('you@example.com');
   ```
8. Reload. You now have full owner access.

The owner claim only works while no owner exists. After that, the database refuses new
claims and only an existing owner can promote someone.

### Supabase Auth settings

In *Authentication → URL Configuration*, set the **Site URL** to the address where you serve the
app. Add local and production redirect URLs, for example:

```
http://localhost:5173
https://your-production-domain.example
```

If email confirmation is enabled, confirm the sign-up email before signing in. Password reset
emails are sent by Supabase Auth.

---

## Database tests and health checks

Paste `supabase/tests.sql` into the SQL editor and run it. The suite runs inside a transaction and rolls back. It creates its own fixtures and exercises order totals,
deposits, stock deduction and reversal, discounts, payments, production, receiving and
immutability. Any failed assertion raises an exception.

Useful checks:

```sql
-- Every cached stock quantity must equal the sum of its ledger entries.
select * from public.check_stock_integrity() where diff <> 0;

-- Raise low-stock notifications on demand.
select public.refresh_low_stock_notifications();
```

The same checks are available in **Admin → Data & integrity**.

---

## What is implemented

### Sales
- Orders from walk-in, website, Instagram, WhatsApp, phone or other; pick-up or delivery.
- Catalogue lines chosen with a searchable product picker **and** custom cake lines with a free-form design brief.
- The interface calls the standard catalogues “Catalogue” items/orders. The underlying
  `ready_made` enum value stays for database compatibility with existing projects.
- Status pipeline: `quote → confirmed → in_production → ready → out_for_delivery → completed`
  (or `cancelled`), with a full status history.
- Deposits, balance payments and refunds; balance recalculated by the database.
- Quotes, invoices and receipts with auto numbers (`QUO-`, `INV-`, `RCT-`) and immutable snapshots.
- Branded print layouts and WhatsApp share links.
- Logged discounts with a reason, plus a configurable staff discount cap.
- Customer directory with lifetime spend, order history, outstanding balances and anonymisation.
- Quotes workspace for enquiries that are not confirmed yet.
- Payment ledger by method (cash, transfer, POS, other), with refunds and outstanding debtors.
- Document register for every issued quote, invoice and receipt.
- Month calendar of pick-ups and deliveries, plus a dispatch board with rider details and status changes.

### Inventory & production
- Vendors, ingredients (unit, cost, stock, reorder level), products (price, cost, stock).
- Recipes (bill of materials) with live cost and margin roll-up.
- Items received and purchase orders (raise → receive → payable → vendor payment).
- Production batches: consume ingredients by recipe, add finished stock, block or override shortages.
- Waste and manual adjustments, all written to an append-only stock ledger.
- Low-stock alerts and ingredient restock reporting.
- Unit conversions for purchasing in bags/litres versus stock in kg/ml.

### Expenses & reporting
- Expenses by category with receipt upload and monthly summary.
- Dashboard KPIs, due orders, low stock, outstanding balances and a setup checklist.
- Reports: revenue, COGS, gross/net profit, average order, cash collected, outstanding, sales trend,
  product performance, top customers and locations, expense breakdown, monthly P&L, daily cash-up
  and restocking — filterable by period.
- One export chooser across reports, expenses, payments, documents, deliveries, the calendar,
  customers and the catalogue: CSV, Excel (`.xls`), Word (`.docx`), PDF or Print.
- Full JSON backup and printable business report.

### Controls
- **Owner vs staff** enforced in Postgres with RLS (not just hidden buttons).
- Soft delete with a restore/purge trash, and immutable documents and stock ledger.
- Audit trail on money and stock tables, with before/after viewing.
- Role-change guard, deactivated accounts, integrity monitor, notifications.
- Naira formatting (`en-NG`), DD/MM/YYYY display, `numeric(14,2)` money columns.
- Mobile-first layout with a labelled sidebar on desktop, an off-canvas drawer with a close
  button on phones/tablets, a light/dark theme toggle, and print styles.
- One-click first-owner setup, with later staff promotion handled by an existing owner.

---

## Business rules live in the database

The UI is a convenience layer; the important rules are triggers and functions in Postgres:

| Rule | Where |
|---|---|
| Order totals from items, discount, delivery and tax | `recalc_order_totals()` |
| Balance follows payments/refunds | `recalc_order_paid()` |
| Completed order deducts finished stock **once** | `deduct_order_stock()` |
| Cancelling an order returns stock exactly once | `reverse_order_stock()` |
| Staff discount cap and discount reason | `validate_order_discount()` |
| Stock receipts/consumption in an immutable ledger | `apply_stock_movement()`, triggers |
| Atomic order creation with lines | `create_order()` RPC |
| Immutable invoice/receipt snapshots | `issue_document()` RPC, block triggers |
| Purchase order receiving | `receive_purchase_order()` RPC |
| Stock take variance posting | `post_stock_take()` RPC |
| Role changes only by an owner | `guard_profile_role()` |
| Audit of inserts/updates/deletes | audit triggers in `002_core_additions.sql` |

---

## File structure

```
cake-inventory/
├── index.html                 sign in / sign up / owner setup / password reset
├── dashboard.html             app shell
├── docs/
│   ├── PRD.md                 product requirements document
│   ├── ARCHITECTURE.md        design architecture
│   ├── live-pitch.md          plain-English pitch source
│   ├── Cake Slice Factory - Live Pitch and Responsibilities.docx
│   └── Cake Slice Factory - Live Pitch and Responsibilities.pdf
├── css/style.css              design system (light/dark themes, responsive, print)
├── js/
│   ├── config.js              Supabase URL, anon key and app configuration
│   ├── supabase.js            live Supabase client + shared data helpers
│   ├── auth.js                session, profile, sign-in/up, owner claim, role checks
│   ├── theme.js               light/dark preference and theme toggle
│   ├── ui.js                  formatting, icons, modals, tables, charts, exports, print
│   ├── crud.js                reusable list/form engine for simple entities
│   ├── app.js                 shell, hash router, notifications
│   └── modules/
│       ├── dashboard.js       KPIs, due orders, low stock, setup checklist
│       ├── orders.js          list, quotes, new order, detail, payments, documents
│       ├── payments.js        payment ledger, refunds and debtors
│       ├── documents.js       issued quote, invoice and receipt register
│       ├── calendar.js        month view of pick-ups and deliveries
│       ├── deliveries.js      dispatch board and rider status
│       ├── customers.js       directory, history, anonymisation
│       ├── products.js        catalogue, prices and finished stock
│       ├── item-picker.js     searchable product suggestions for order lines
│       ├── ingredients.js     ingredient stock
│       ├── vendors.js         supplier records
│       ├── recipes.js         bill of materials + costing
│       ├── production.js      batches, availability preview, waste
│       ├── purchases.js       items received, purchase orders, payables
│       ├── expenses.js        expenses, receipts, monthly summary
│       ├── reports.js         all summaries and exports
│       └── admin.js           settings, users, audit, trash, notifications, data
├── supabase/
│   ├── schema.sql             base schema (run first)
│   ├── 002_core_additions.sql controls & safety features (run second)
│   ├── 003_owner_setup.sql    first-run owner claim (run third)
│   ├── 004_website_catalogue.sql website channel + live menu import (run fourth)
│   └── tests.sql              transactional regression suite
└── tools/
    ├── serve.js               zero-dependency static server
    ├── md2html.js             styled Markdown to document HTML
    ├── html2word.ps1          Word/PDF conversion through Microsoft Word
    └── docx2md.js             converts the source .docx documents to Markdown
```

---

## Live configuration checks

- If `SUPABASE_URL` or `SUPABASE_ANON_KEY` is missing, the sign-in page shows a setup notice and
  the app does not open a local database.
- The anon key is safe to ship; all data access is constrained by RLS.
- Uploads use the private Supabase Storage bucket `cake-files`; links are signed for one hour.
- There is no scheduled cloud backup. Owners can download a full JSON snapshot from
  **Admin → Data & integrity**.
- Notifications are generated by database triggers and refreshed in the app.

---

## Formatting and conventions

- Currency: `₦` with `en-NG` grouping; inputs are plain naira amounts.
- Dates display as `DD/MM/YYYY`; storage uses ISO timestamps/dates.
- Money columns are `numeric(14,2)`; quantities are `numeric(14,3)` for ingredients.
- All deletions are soft (`deleted_at`) except where history must stay immutable.
- Order numbers, batch numbers and document numbers are generated by the database, never the client.
