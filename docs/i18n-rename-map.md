# Identifier rename map (Turkish → English)

Applies to everything that crosses a process boundary: MCP tool names, argument names and enum values.
These are **identifiers**, never wrapped in `t()`. Every file must use the new names consistently.

MCP server name: `ekip` → `team` (tool ids seen in the UI become `mcp__team__<tool>`).

| old tool | new tool | old arg → new arg (enum values) |
|---|---|---|
| `gorev_ver` | `assign_task` | `rol`→`role`, `gorev`→`task` |
| `kardes_projeye_bildir` | `notify_project` | `proje`→`project`, `mesaj`→`message` |
| `gereksinimleri_kaydet` | `save_requirements` | `mod`→`mode` (`birlestir`→`merge`, `degistir`→`replace`), `maddeler`→`items`; item fields: `kod`→`code`, `baslik`→`title`, `detay`→`detail`, `bolum`→`section`, `kaynak`→`source`, `dokuman_durumu`→`doc_claim` (`yapıldı`→`done`, `kısmen`→`partial`, `yapılmadı`→`todo`, `belirtilmemiş`→`unspecified`), `dokuman_alinti`→`doc_quote`, `durum`→`status`, `bolumler`→`sections`, `kabul_kriterleri`→`acceptance_criteria` |
| `dokuman_bolumleri` | `document_sections` | `durum`→`filter` (`boştakiler`→`open`, `değişenler`→`changed`, `silinenler`→`removed`, `işaretliler`→`marked`, `hepsi`→`all`), `belge`→`doc`, `baslangic`→`start` |
| `bolum_isaretle` | `mark_sections` | `bolumler`→`sections`, `gerekce`→`reason`, `kaldir`→`remove` |
| `gereksinim_detay` | `requirement_detail` | `kod`→`code` |
| `eksik_gereksinim_bildir` | `report_missing_requirements` | `maddeler`→`items` (fields as in save_requirements), `neden`→`why` |
| `gereksinim_durumu` | `set_requirement_status` | `kod`→`code`, `durum`→`status`, `kanit`→`evidence`, `not`→`note` |
| `gereksinimleri_listele` | `list_requirements` | `durum`→`status`, `sadece_uyusmazlik`→`only_mismatches` |
| `gereksinim_dogrula` | `verify_requirement` | `kod`→`code`, `sonuc`→`result` (`doğrulandı`→`verified`, `başarısız`→`failed`), `nasil`→`how`, `kanit`→`evidence`, `kriterler`→`criteria` (items: `no`, `sonuc`→`result` (`geçti`→`pass`, `kaldı`→`fail`), `not`→`note`) |

Work-status enum (`STATUS` in team-mcp.js, the `status` argument above):
`yapılmadı`→`todo`, `yapılıyor`→`doing`, `tamam`→`done`, `belirsiz`→`unclear`, `kapsam dışı`→`out_of_scope`.
Internally the station keeps `dropped` for out-of-scope items; `runTool` maps `out_of_scope` ↔ `dropped`.

Requirement codes: new items get the prefix `R-` (was `G-`). Existing data may still contain `G-…`
codes; code generation must take the highest number of any `<LETTERS>-<digits>` code.

Other identifiers that stay as they are (already English or data): status ids `todo/doing/done/unclear/dropped`,
verify states `none/verified/failed/stale`, claim values `done/partial/todo`, criteria states `none/pass/fail`,
role ids `dev/analyst/tester/reviewer`, section ids `D1-004`, env vars `ECELON_*`.
