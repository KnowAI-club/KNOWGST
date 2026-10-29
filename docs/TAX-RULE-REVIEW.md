# Tax-rule review — 29 October 2026

This is an implementation review with bounded regression fixtures, not certification of every GST classification, return schema or taxpayer scenario. Historical financial arithmetic is preserved. The original source remains traceable through UPSTREAM-MANIFEST.json; the filing-year rejection change is separately recorded in FINANCIAL-CHANGES.json.

## Income tax

FY 2025–26 / AY 2026–27 remains a valid filing workspace under the earlier Act. Income earned from April 2026 belongs to Tax Year 2026–27 under the Income-tax Act, 2025. Replacing the historical year label would incorrectly mix periods. The filing engine now rejects unsupported years instead of silently returning an older year's rules.

The separate current-year estimator is limited to ordinary income of resident individuals with taxable income up to ₹50 lakh. It implements the 0/5/10/15/20/25/30 percent slabs at ₹4/8/12/16/20/24 lakh, eligible salary standard deduction up to ₹75,000, rebate up to ₹60,000 at income up to ₹12 lakh, marginal relief and 4 percent cess. It rounds the final estimate to the nearest ₹10. It is not a full ITR engine: special-rate income, capital gains, surcharge, nonresident cases and other deductions are excluded. Full statutory rounding and all category-specific treatments require a further filing-engine review.

The AY 2026–27 deadline copy distinguishes non-business/non-audit returns, non-audit business/profession and audit cases. Circular 7/2026 extends the covered audited-return deadline to 21 November 2026. Special categories and subsequent extensions must be checked separately.

Official evidence consulted:

- [Income-tax Act transition and scope](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/objective-and-scope-new-act)
- [Income-tax Department: rates and computation](https://www.incometaxindia.gov.in/w/tax-rates-and-computation)
- [Section 202, Income-tax Act 2025](https://wmstatic-prd.incometaxindia.gov.in/web/guest/w/section-202-78) — official indexed text; direct retrieval was blocked during review.
- [Section 19 salary deductions](https://wmstatic-prd.incometaxindia.gov.in/web/guest/w/section-19-199) — official indexed text.
- [PIB: extension for AY 2026–27 audit cases](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2316050&lang=1&reg=3)
- [Income-tax Department return-filing FAQ](https://www.incometax.gov.in/iec/foportal/node/11724)

## GST

The upstream HSN table contains historical rates and cannot safely certify current classification. Automatic replacement of the user's selected GST rate when an HSN is entered is disabled. Description hints remain labelled “Check rate.” Historical rate options remain available for historical transactions. Existing invoices are not recalculated.

The September 2025 changes and later product-specific changes mean a blanket rewrite of the table would be unsafe. Rate selection must consider classification and time of supply, including transition rules; invoice date alone is insufficient. No claim is made that every current goods/service classification has been audited.

- [56th GST Council FAQs and time-of-supply guidance](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2163560&lang=1&reg=3)
- [Official September 2025 implementation FAQs](https://www.pib.gov.in/newsite/archiveContent.aspx?lang=2&reg=48&relid=276214)
- [GST Council December 2025 newsletter](https://gstcouncil.gov.in/sites/default/files/2026-01/monthly_newsletter_december_2025_1.pdf)
- [CBIC invoice particulars](https://cbic-gst.gov.in/gst-invoice-rules.html)

GST export/PDF generation is distinct from submission or IRN registration. Live government filing, e-invoice registration and current portal-schema acceptance remain release gates.

## Regression coverage

`apps/parity/tests/tax-review.test.mjs` covers ordinary-income slab boundaries, rebate, marginal relief, unsupported-year rejection, salary deduction and estimator bounds. Existing source tax and discount suites remain in the test run. Browser tests cover the current-year estimate and prove that changing HSN does not overwrite selected rates. This does not establish correctness of every historical capital-gains, business-income or special-category path.
