# Product Requirements Document

## Cake Slice Factory — Sales, Inventory & Expense Management

| Field | Value |
| --- | --- |
| Product | Cake Slice Factory |
| Version | 1.0 (Draft for approval) |
| Status | Ready for review |
| Document owner | Business owner (product sponsor) |
| Prepared by | Engineering |
| Last updated | 2026-10-21 |
| Stack | HTML, CSS, JavaScript, Supabase (Postgres + Auth + Storage + Realtime) |

## 1. Overview

### 1.1 Problem statement

Cake Slice Factory sells cakes through walk-in customers and via Instagram and WhatsApp, and bakes from raw ingredients. Today orders, ingredient stock, production and expenses are tracked by hand (notebooks, WhatsApp chats, memory). The consequences are:

No reliable picture of what is in stock (ingredients or finished cakes).

Orders taken on Instagram/WhatsApp are easy to lose or forget, and delivery dates slip.

Prices are guessed because true cost per cake (from the recipe) is not known.

Money leaks: expenses are unrecorded, so profit is unknown.

No accountability — anyone can change a price or delete a record with no trace.

Repeating customers are not recognised, and top locations are unknown, so no marketing decisions.

### 1.2 Product vision

One simple, mobile-friendly web app that runs the whole operation: take an order from any channel, track the ingredients and finished cakes it consumes, record every naira in and out, and print a professional quote/invoice/receipt — all with an accurate profit picture for the owner.

### 1.3 Objectives (12 months)

| # | Objective | Target |
| --- | --- | --- |
| O1 | Every sale is recorded in the system | ≥ 95% of orders |
| O2 | No order forgotten | 0 missed fulfilment dates |
| O3 | Ingredient stock is knowable at any time | 100% of stock movements logged |
| O4 | True cost & margin per product | Known for all active products |
| O5 | Know monthly profit | Report available within 1 day of month end |
| O6 | Accountability for edits | 100% of money-affecting changes audited |

### 1.4 Success metrics (KPIs)

Adoption: % of orders entered per week; active staff users per day.

Data quality: % of orders with a linked customer; % of products with a recipe.

Business value: gross margin % trend; stock-out incidents per month; unrecorded-expense count (target 0).

Speed: median time to record a walk-in order (< 45 seconds).

Reliability: order data loss incidents (target 0).

## 2. Personas & Roles

| Persona | Description | Primary goals | Device |
| --- | --- | --- | --- |
| Owner / Sponsor | Runs the business, prices products, decides. | Profit visibility, control, accountability. | Phone + laptop |
| Front-desk staff | Takes orders at the counter and via Instagram/WhatsApp. | Record an order fast; issue a receipt; answer "do we have it?" | Phone (counter) |
| Baker / Production staff | Bakes, records output, consumes ingredients. | Log a batch, know what's in the store. | Phone/tablet |
| Accountant (Phase 2) | Periodic review of expenses and payables. | Clean expense data, exportable. | Laptop |

### 2.1 Role & permission matrix

| Capability | Owner | Staff |
| --- | --- | --- |
| View dashboard & reports | ✅ | ✅ |
| Create/edit/delete products, ingredients, vendors, recipes | ✅ | ❌ (read-only) |
| Set selling prices & discounts | ✅ | ⚠️ discount capped, logged |
| Create/edit orders, customers, payments | ✅ | ✅ |
| Complete / cancel an order | ✅ | ⚠️ configurable |
| Void or delete a completed order | ✅ | ❌ |
| Record production batches | ✅ | ✅ |
| Record items received / purchases | ✅ | ✅ |
| Record expenses | ✅ | ✅ |
| Run stock take | ✅ | ✅ |
| Manage users & roles | ✅ | ❌ |
| View audit log | ✅ | ❌ |
| Export data / backup | ✅ | ❌ |

Permissions are enforced in the database with Row Level Security, not just in the UI.

## 3. Scope

### 3.1 In scope

Sales (walk-in, Instagram, WhatsApp, phone), customers, orders (ready-made and custom cakes), a quotes workspace, delivery vs pick-up, a month calendar and dispatch board, issued quotes/invoices/receipts, a payment ledger with balances, finished-goods inventory, ingredient inventory, recipes, vendor records, items received, production batches, stock ledger, expenses, reporting and analytics, multi-format exports, users and permissions.

### 3.2 Out of scope (v1)

Payroll calculation, full double-entry accounting, e-commerce storefront, native mobile apps, multi-currency, multi-branch, automated marketing campaigns, barcode hardware.

### 3.3 Future scope (v2+)

Multi-branch, customer self-service order form, loyalty/promotions, demand forecasting, vendor price comparison, barcode scanning, offline-first sync with conflict resolution.

## 4. Features Added Beyond the Original Brief

The owner listed Sales, Inventory and Expenses. The following features were not requested but are necessary for the system to be safe, trustworthy and actually usable in a real cake business. Each is prioritised with MoSCoW (Must, Should, Could, Won't-yet).

### 4.1 Critical — the system is unsafe without these

| # | Feature | Why it is necessary | Priority |
| --- | --- | --- | --- |
| A1 | Users, roles & permissions | Money-handling systems need accountability. Anyone editing prices/stock must be identified. | M |
| A2 | Audit / activity log | "Who changed this price? Who deleted that order?" must be answerable. Immutable history of money-affecting changes. | M |
| A3 | Refunds, cancellations & stock reversal | Stock is deducted when an order completes. Without a reversal path, cancelling an order permanently corrupts stock. | M |
| A4 | Balances, debtors & part payments | Real customers pay a deposit then balance. Without this, "who owes me money?" is unanswerable. | M |
| A5 | Discounts & price overrides (logged) | Discounting is normal; undisciplined discounting destroys margin. Must be captured and attributed. | M |
| A6 | Waste, spoilage & returns | Cakes burn, ingredients expire, items are returned. Unrecorded waste silently breaks stock accuracy. | M |
| A7 | Data export & backup | Business continuity. The owner must be able to extract their own data as CSV, Excel, Word, PDF or print, and restore from a full JSON snapshot. | M |
| A8 | Offline / poor-network resilience | Nigerian mobile data drops mid-order. The app must not silently lose a sale. | M |
| A9 | Soft delete + restore (trash) | Accidental deletes must be recoverable; history must never break. | M |
| A10 | Input validation & clear error handling | Bad data (negative stock, missing phone) destroys reports. | M |
| A11 | Mobile-first responsive UI | Orders are taken on a phone at the counter. Desktop-only fails. | M |
| A12 | Tax (VAT) handling & rounding rules | Invoices must be legally correct and totals must reconcile to the kobo. | M |
| A13 | Branded document printing | Quote/invoice/receipt must carry business name, address, phone and logo to be professional. | M |
| A14 | Low-stock alerts & reorder points | The whole point of inventory — know before you run out. | M |
| A15 | Search, filter, sort, pagination | With hundreds of products/orders, a plain list is unusable. | M |

### 4.2 Important — needed for real day-to-day operation

| # | Feature | Why it matters | Priority |
| --- | --- | --- | --- |
| B1 | Customer CRM & purchase history | Repeat customers are the core of a cake business; enables "last order again". | S |
| B2 | WhatsApp deep-link to send quote/invoice/receipt | Matches how the business actually communicates; removes manual re-typing. | S |
| B3 | Production calendar & order scheduling | Prevents double-booking the oven and missed delivery dates. | S |
| B4 | Unit conversion (bag ↔ kg ↔ g) | Ingredients are bought in 50 kg bags but recipes use grams. Without this, recipes are wrong. | S |
| B5 | Recipe costing & margin analysis | Shows true cost per cake and profit per product → correct pricing. | S |
| B6 | Purchase orders & vendor payables | Order ingredients ahead; track what you owe vendors. | S |
| B7 | Stock take / physical count & variance | The only way to detect and correct drift between system and reality. | S |
| B8 | Batch & expiry tracking | Perishable ingredients (dairy, eggs) must be used oldest-first. | S |
| B9 | Delivery/rider assignment & delivery status | Deliveries fail silently without ownership of the trip. | S |
| B10 | Attachments (cake reference photos, expense receipts) | Evidence for custom orders and expense claims. | S |
| B11 | Price history | Explains price changes; supports margin trend analysis. | S |
| B12 | In-app notifications (low stock, due orders) | Turns the system from passive record to active assistant. | S |
| B13 | Daily sales close / cash-up summary | End-of-day reconciliation between cash received and orders recorded. | S |
| B14 | Profit & Loss and cash-flow reports | The owner's core question: "did I make money?" | S |
| B15 | Void / override controls | Fraud prevention: restricts who can void and requires a reason. | S |
| B16 | Stock movement reason codes | Every adjustment must say why, or the ledger is useless. | S |
| B17 | Password reset & session management | Users must self-serve; sessions must expire safely. | S |
| B18 | Onboarding & guided setup | A blank system is never adopted; guided first-run matters. | S |

### 4.3 Nice to have

| # | Feature | Priority |
| --- | --- | --- |
| C1 | Multi-branch / location support | C |
| C2 | Barcode / QR scanning for products | C |
| C3 | Loyalty points & promotions engine | C |
| C4 | Vendor price comparison & best-vendor suggestions | C |
| C5 | Demand forecasting from historical sales | C |
| C6 | Dark mode | C |
| C7 | Multi-currency | C |
| C8 | Public customer order form (self-service) | C |
| C9 | Two-factor authentication for owner accounts | C |
| C10 | Automated off-site backup schedule | C |

## 5. Functional Requirements

Each requirement has a stable ID (M<module>-FR-<n>), a priority, and acceptance criteria (AC).

### M1 — Identity & Access

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| M1-FR-00 | First-run owner setup | M | The first signed-in account claims owner once from the sign-in page; a second claim is refused by the database |
| M1-FR-01 | Users sign up / sign in with email + password | M | Valid credentials issue a session; invalid show an inline error |
| M1-FR-02 | Password reset by email | M | User receives link and can set a new password |
| M1-FR-03 | Owner can invite/create staff accounts and set role | M | New account defaults to staff; owner can set owner/staff |
| M1-FR-04 | Owner can deactivate a staff member | S | Deactivated user cannot sign in; their history is retained |
| M1-FR-05 | Sessions persist across reloads and auto-refresh | M | Reload keeps user signed in; expired session redirects to login |
| M1-FR-06 | All data access is row-level filtered by role | M | Staff cannot write to products/ingredients/vendors/recipes via API |

### M2 — Product Catalog (finished cakes)

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| M2-FR-01 | Create a product with name, SKU, category, flavour, size, unit, price, cost, stock, low-stock level, image, status | M | Product appears in list and is searchable immediately |
| M2-FR-02 | Distinguish ready-made vs custom (made-to-order) products | M | Custom products do not require tracked stock |
| M2-FR-03 | Edit any product field | M | Changes persist; an audit entry is written; price change recorded in price history |
| M2-FR-04 | Soft-delete (archive) a product; restore from trash | M | Archived product is hidden from new orders but retained in history |
| M2-FR-05 | Duplicate a product (fast variant creation) | C | New row is created with " (copy)" suffix |
| M2-FR-06 | Search by name/SKU; filter by category, kind, status, stock level | M | Filters combine correctly and return within 1s |
| M2-FR-07 | Show computed margin % per product | S | margin = (price − cost) / price |

### M3 — Ingredients & Recipes

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| M3-FR-01 | Create/edit ingredients with unit, cost per unit, stock, low-stock level, preferred vendor | M | Saved and reflected in stock list |
| M3-FR-02 | Define a recipe (bill of materials) per product | M | Recipe shows ingredients with quantities and rolled-up cost |
| M3-FR-03 | Recipe cost rolls up into product cost | S | Product cost updates when ingredient costs change (recalc action) |
| M3-FR-04 | Unit conversions per ingredient (e.g. 1 bag = 50 kg) | S | Purchase in bags; recipe consumes kg correctly |
| M3-FR-05 | Batch/lot + expiry per received quantity | S | Expiry warnings surface ingredients near expiry |
| M3-FR-06 | Low-stock and expiry alert list | M | Alerts appear on dashboard and are filterable |

### M4 — Vendors & Purchasing

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| M4-FR-01 | Create/edit vendor with contact, phone, email, address, supplies | M | Vendor selectable in purchases and expenses |
| M4-FR-02 | Record items received (ingredient, qty, unit cost, date, vendor) | M | Ingredient stock increases and a ledger row is written |
| M4-FR-03 | Update ingredient cost from latest purchase | S | cost_per_unit reflects most recent non-zero unit cost |
| M4-FR-04 | Raise a purchase order to a vendor and mark received | S | Received PO creates purchase rows and stock movements |
| M4-FR-05 | Vendor payables summary | S | Total owed per vendor = received POs − payments |

### M5 — Production

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| M5-FR-01 | Record a production batch (product, qty, date, note) | M | Batch number auto-generated |
| M5-FR-02 | Consume recipe ingredients on batch creation | M | Ingredient stock decreases by recipe qty × batch qty; ledger rows written |
| M5-FR-03 | Increase finished-cake stock on batch creation | M | Product stock increases by quantity produced |
| M5-FR-04 | Warn when producing more than available ingredients | M | User is warned and must confirm an override (logged) |
| M5-FR-05 | Production calendar showing batches and order due dates | S | Dated view of work outstanding |
| M5-FR-06 | Record waste/spoilage against a batch | M | Waste logged with reason; stock adjusted |

### M6 — Sales & Orders

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| M6-FR-01 | Record customer name and phone on every order | M | Order cannot be saved without a customer name |
| M6-FR-02 | Capture channel: walk-in, Instagram, WhatsApp, phone, other | M | Channel recorded and reportable |
| M6-FR-03 | Add multiple line items (product, qty, unit price) | M | Line totals and order subtotal compute automatically |
| M6-FR-04 | Create custom cake orders with free-form details and price | M | Custom details stored and shown on documents |
| M6-FR-05 | Choose delivery or pick-up | M | Delivery requires an address; pick-up does not |
| M6-FR-06 | Capture delivery/pick-up date and address | M | Date required; address required when delivery |
| M6-FR-07 | Apply discounts (amount or %) with permission + reason | M | Discount stored, attributable, shown on documents |
| M6-FR-08 | Order status pipeline: quote → confirmed → in_production → ready → out_for_delivery → completed / cancelled | M | Status changes are timestamped and attributed |
| M6-FR-09 | Deduct finished-cake stock once when an order is completed | M | Stock decreases exactly once per order |
| M6-FR-10 | Reverse stock when a completed order is cancelled or refunded | M | Stock returns; reversal ledger rows written; never double-reversed |
| M6-FR-11 | Reorder a previous order in one click | C | New draft order copies prior line items |
| M6-FR-12 | Search/filter orders by number, customer, status, channel, date | M | Results correct and fast |
| M6-FR-13 | Assign a rider and track delivery status | S | Delivery has an owner and a status |
| M6-FR-14 | Prevent duplicate order submission | M | Double-click/submit does not create two orders |

### M7 — Payments & Documents

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| M7-FR-01 | Record payments/deposits against an order | M | amount_paid and balance update automatically |
| M7-FR-02 | Support cash, transfer, POS, other | M | Method recorded and reportable |
| M7-FR-03 | Show outstanding balance and a debtors list | M | Orders with balance > 0 are listed with amount owed |
| M7-FR-04 | Record a refund (negative payment) | M | Refund reduces amount_paid and appears in cash reports |
| M7-FR-05 | Generate a quote, invoice and receipt per order | M | Each has an auto number (QUO-/INV-/RCT-) |
| M7-FR-06 | Print / PDF exported documents with business branding | M | Business name, address, phone and logo present |
| M7-FR-07 | Share a document via WhatsApp deep link | S | Opens WhatsApp with a pre-filled message |
| M7-FR-08 | Documents are immutable snapshots | S | Re-printing shows the values at issue time |
| M7-FR-09 | Payment ledger by method with refunds and outstanding balances | M | Every deposit, balance and refund is visible and reconciles to the order |
| M7-FR-10 | Document register for issued quotes, invoices and receipts | M | Owner can find, reprint or export any issued document |
| M7-FR-11 | Quotes workspace separate from confirmed orders | S | Open quotes can be reviewed without mixing them into live production |
| M7-FR-12 | Month calendar and delivery dispatch board | S | Due work is grouped by date; orders move ready → out for delivery → completed |

### M8 — Customers & CRM

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| M8-FR-01 | Maintain customer records (name, phone, email, address, city, state, channel) | M | Customer is searchable and reusable across orders |
| M8-FR-02 | Detect existing customer by phone and auto-fill | M | Typing a known phone populates the customer |
| M8-FR-03 | View a customer's order history and lifetime spend | S | History and total shown on the customer page |
| M8-FR-04 | City/state captured for location reporting | M | Orders can be grouped by location |

### M9 — Expenses

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| M9-FR-01 | Record ingredient purchases with the vendor | M | Purchase is recorded and linked to ingredient stock |
| M9-FR-02 | Record other expenses with category (logistics, salaries, rent, utilities, marketing, equipment, packaging, other) | M | Categorised and reportable |
| M9-FR-03 | Attach a receipt photo to an expense | S | Image stored in Supabase Storage and viewable |
| M9-FR-04 | Optionally link an expense to an order (job costing) | S | Order profit reflects linked costs |
| M9-FR-05 | Expense summary by month and category | M | Totals reconcile to the underlying rows |

### M10 — Reporting & Analytics

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| M10-FR-01 | Dashboard KPIs: today's orders/revenue, month revenue, total stock value, low-stock count, outstanding balance | M | Numbers match underlying data |
| M10-FR-02 | Highest-selling product (by qty and by revenue) | M | Correct ranking for a selected period |
| M10-FR-03 | Top customer by spend | M | Correct ranking for a selected period |
| M10-FR-04 | Highest-revenue location (city/state) | M | Correct ranking for a selected period |
| M10-FR-05 | Ingredients restocked the most, with quantity and amount | M | Correct ranking |
| M10-FR-06 | Sales trend over time (day/week/month) | S | Chart renders for the period |
| M10-FR-07 | Profit & Loss (revenue − COGS − expenses) by period | S | Totals reconcile to orders and expenses |
| M10-FR-08 | Daily sales close / cash-up summary | S | Day's totals by payment method |
| M10-FR-09 | Export any list or report to CSV, Excel, Word, PDF or print | M | Export chooser offers all five formats and each output opens cleanly |

### M11 — Platform & Administration

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| M11-FR-01 | Business settings: name, address, phone, currency, tax rate, logo, receipt footer | M | Settings appear on documents |
| M11-FR-02 | Audit log of create/update/delete on money-affecting tables | M | Owner can filter by user, table, date |
| M11-FR-03 | Trash / restore for soft-deleted records | M | Deleted item restorable by owner |
| M11-FR-04 | Notifications: low stock, orders due today, overdue balances | S | Listed in-app with unread state |
| M11-FR-05 | Onboarding checklist / guided live setup | S | A new install can be configured safely |
| M11-FR-06 | Realtime updates when two users are online | S | Stock changes appear without reload |

### M12 — Data & Compliance

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| M12-FR-01 | Manual full export (all tables) as CSV/JSON | M | Owner can download everything |
| M12-FR-02 | Soft delete everywhere; no hard deletes from the UI | M | No UI path can irreversibly delete money records |
| M12-FR-03 | Customer data used only for orders; deletable on request | S | Customer anonymisation action available to owner |
| M12-FR-04 | Referential integrity across all relationships | M | Deleting a vendor keeps history (set null) |

## 6. Non-Functional Requirements

| ID | Area | Requirement |
| --- | --- | --- |
| NFR-01 | Performance | First meaningful paint < 3 s on 3G; typical list/search response < 1 s for 10k records |
| NFR-02 | Scale | Support ≥ 5,000 products, 100,000 orders, 500,000 stock movements without redesign |
| NFR-03 | Availability | ≥ 99.5% monthly (inherits Supabase SLA) |
| NFR-04 | Security | TLS in transit; encryption at rest; RLS on every table; anon key only in client; no service-role key shipped |
| NFR-05 | Privacy | Customer phone numbers accessible only to authenticated staff; not exposed publicly |
| NFR-06 | Reliability | Order submission must not silently fail; failed writes are surfaced and retryable |
| NFR-07 | Connectivity | A dropped connection shows a clear warning; writes require the live database and are never silently queued |
| NFR-08 | Usability | Walk-in order recordable in < 45 s by a first-time user after a short walkthrough |
| NFR-09 | Accessibility | Keyboard navigable, WCAG 2.1 AA contrast, labelled form fields |
| NFR-10 | Compatibility | Latest Chrome, Safari, Edge, Firefox; Android Chrome and iOS Safari primary |
| NFR-11 | Localisation | Currency ₦ (NGN), locale en-NG, DD/MM/YYYY dates; structured for future locales |
| NFR-12 | Maintainability | No build step; ES modules; one module per domain; documented schema migrations |
| NFR-13 | Observability | Client errors logged with context; audit log for business-critical changes |
| NFR-14 | Backup/Restore | Database backups are controlled in Supabase; owner can download a full JSON snapshot; restore procedure documented |
| NFR-15 | Time | All timestamps stored UTC, displayed in local time |
| NFR-16 | Theme & navigation | Every page has a labelled desktop menu, a closable mobile drawer, and a persistent light/dark theme toggle |

## 7. Business Rules

| ID | Rule |
| --- | --- |
| BR-01 | An order cannot be saved without a customer name and at least one line item or custom description. |
| BR-02 | A delivery order requires a delivery address; a pick-up order does not. |
| BR-03 | A delivery/pick-up date is required for any order that is not an open quote. |
| BR-04 | Stock is deducted from finished cakes exactly once, when the order becomes completed. |
| BR-05 | Cancelling or refunding a completed order reverses the stock deduction; reversals are idempotent. |
| BR-06 | Custom (made-to-order) products do not hold stock and are never deducted. |
| BR-07 | Creating a production batch consumes recipe ingredients and increases finished-cake stock atomically. |
| BR-08 | Producing more than the available ingredients requires an explicit, logged override. |
| BR-09 | Stock is allowed to go negative only with an owner override; otherwise the action is blocked with a warning. |
| BR-10 | Only the owner can create, edit or delete products, ingredients, vendors and recipes. |
| BR-11 | Only the owner can void or delete a completed order; staff must request it. |
| BR-12 | Discounts above a configurable threshold require the owner role. |
| BR-13 | Every stock change must carry a reason code. |
| BR-14 | Order totals are always recalculated from line items: total = subtotal − discount + delivery_fee + tax. |
| BR-15 | amount_paid is always the sum of payments (refunds are negative payments). |
| BR-16 | Quote/Invoice/Receipt numbers are unique and sequential. |
| BR-17 | Records are soft-deleted; history and reports must never show gaps from deletions. |
| BR-18 | Ingredient cost per unit updates from the most recent purchase with a non-zero unit cost. |
| BR-19 | A customer is matched by phone number (normalised) before creating a new record. |
| BR-20 | All money is stored to 2 decimal places and rounded half-up. |

## 8. Data Requirements (summary)

Primary entities and their purpose are detailed in ARCHITECTURE.md §4. Summary: profiles, settings, vendors, ingredients, products, recipes, customers, orders, order_items, payments, documents, production_batches, stock_movements, ingredient_purchases, expenses, plus the additions in supabase/002_core_additions.sql (audit_log, purchase_orders, purchase_order_items, stock_takes, stock_take_items, attachments, notifications, unit_conversions, price_history, order_status_history).

## 9. Release Plan

| Release | Contents | Exit criteria |
| --- | --- | --- |
| R0 — Foundation | Schema, RLS, auth, app shell, generic CRUD | Owner can sign in and manage products |
| R1 — Inventory | Products, ingredients, vendors, recipes, low-stock alerts | Stock can be maintained accurately |
| R2 — Sales | Customers, orders, custom cakes, payments, documents | A real order can be recorded and receipted end-to-end |
| R3 — Production & Expenses | Batches, items received, expenses | Ingredient consumption and costs tracked |
| R4 — Reporting & Controls | All report views, exports, audit log, trash, notifications | Owner answers all briefing questions from the app |
| R5 — Hardening | Offline queue, realtime, storage uploads, PDF export, stock takes, purchase orders | NFR targets met |

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Staff resist data entry | High | Sub-45-second order flow; mobile-first; offline tolerance; training |
| Poor connectivity | High | Offline queue + retry; local read cache |
| Stock drift from reality | High | Reason-coded movements; periodic stock take; waste logging |
| Wrong prices/costs | Medium | Recipe costing; price history; margin report |
| Unauthorised edits | High | RLS + audit log + owner-only catalog writes |
| Key person dependency | Medium | Documented setup; exports; no bespoke tooling |
| Scope creep | Medium | MoSCoW priorities; phased releases |

## 11. Assumptions & Dependencies

Supabase project is available and stays on a paid/adequate tier for backups.

Users have a smartphone or computer with a modern browser and intermittent internet.

The owner will enter the initial product and ingredient catalogue during guided setup.

Naira (₦) is the only currency in v1.

## 12. Open Questions

Should staff be able to complete orders, or only owners? (Affects M6-FR-08.)

Is VAT registration in place, or should tax default to 0%? (Affects M11-FR-01, M12.)

Are deposits mandatory for custom cakes above a value threshold? (Affects M7-FR-01.)

Which states/cities should be pre-loaded for location reporting?

Should quotes be convertible to invoices in one click? (Recommended: yes.)

Is a printed thermal receipt (58/80 mm) required, or is A4/PDF sufficient?

## 13. Glossary

| Term | Meaning |
| --- | --- |
| Ready-made | A cake baked in advance and held in finished-goods stock. |
| Custom | A made-to-order cake; no stock held; free-form brief. |
| BOM / Recipe | Bill of materials — ingredients and quantities per unit of product. |
| COGS | Cost of goods sold — ingredient cost of what was sold. |
| Stock movement | A single logged change to a stock quantity, with a reason. |
| Stock take | Physical count compared with system quantity to find variance. |
| RLS | Row Level Security — Postgres rules that filter rows per user. |
| Soft delete | Marking a row deleted (deleted_at) instead of removing it. |
