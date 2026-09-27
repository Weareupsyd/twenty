#!/usr/bin/env python3
"""
Protecta Bode email design system + template pack builder.

Follows the supplied `email_design system.html` (660px XHTML table layout,
hidden preheader, logo header, large title section, dark footer band with
help block + legal small print, dark-mode + 3 mobile breakpoints) and the
rendering approach proven in the AgriLink email service (inline, unbadged
Hugeicons-style SVGs - email clients do not load icon fonts).

Re-branded for Protecta Bode / Liberty General Insurance Uganda:
  page #EEF8FB · card #FFFFFF · navy #0B1C48 · orange #CA6E2B · ink #162044
  logo: assets/protecta-bode-logo-on-white.png (extracted from
        "Protecta Bode on white .svg" - SVG logos do not render in Gmail/Outlook)

Run:  python3 build_emails.py     (writes *.html next to this script + index.html)
"""
from __future__ import annotations

import html
import os

HERE = os.path.dirname(os.path.abspath(__file__))

# ── Brand tokens (mirror protectabode-landing.html) ─────────────────────────
NAVY = "#0B1C48"
NAVY_DARK = "#081230"      # footer in dark mode
ORANGE = "#CA6E2B"
ORANGE_DARK = "#B25E20"
PAGE = "#EEF8FB"           # sky-soft page background
INK = "#162044"
MUTED = "#56607F"
LINE = "#BCDCE7"           # sky-line
WHITE = "#FFFFFF"
DARK_PAGE = "#101a33"      # dark-mode page
DARK_CARD = "#1B2440"      # dark-mode card

LOGO_URL = "../assets/protecta-bode-logo-on-white.png"
# Local/preview path. At send time the email service rewrites it to the hosted
# URL, e.g. https://cdn.protectabode.example/emails/protecta-bode-logo-on-white.png
# (extracted from "Protecta Bode on white .svg" - raw SVG does not render in
# Gmail/Outlook, so the embedded PNG is used instead).

PHONE = "0312 246500"
PHONE_HREF = "tel:+256312246500"
WHATSAPP = "+256 740 446 717"
WHATSAPP_HREF = "https://wa.me/256740446717"
EMAIL_ADDR = "info@liberty.co.ug"
PORTAL_URL = "https://PROTECTA-PORTAL.example"

FONT_DISPLAY = "'Poppins',Arial,sans-serif"
FONT_BODY = "'Noto Sans',Arial,sans-serif"

# ── Hugeicons-style inline SVGs (Stroke Rounded, unbadged) ──────────────────
# Sources: the curated set already proven in the AgriLink email service
# (invoice, coins, sale tag, wallet, lock password, agreement, mail open,
# shield, phone, mail, pdf). New additions (clock, users, headset, calendar)
# follow the same 24px / 1.5 rounded-stroke style - swap for exact paths from
# hugeicons.com before production if pixel fidelity matters.
ICONS: dict[str, str] = {
    "shield": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    "invoice": '<path d="M4 18.6458V8.05426C4 5.20025 4 3.77325 4.87868 2.88663C5.75736 2 7.17157 2 10 2H14C16.8284 2 18.2426 2 19.1213 2.88663C20 3.77325 20 5.20025 20 8.05426V18.6458C20 20.1575 20 20.9133 19.538 21.2108C18.7831 21.6971 17.6161 20.6774 17.0291 20.3073C16.5441 20.0014 16.3017 19.8485 16.0325 19.8397C15.7417 19.8301 15.4949 19.9768 14.9709 20.3073L13.06 21.5124C12.5445 21.8374 12.2868 22 12 22C11.7132 22 11.4555 21.8374 10.94 21.5124L9.02913 20.3073C8.54415 20.0014 8.30166 19.8485 8.03253 19.8397C7.74172 19.8301 7.49493 19.9768 6.97087 20.3073C6.38395 20.6774 5.21687 21.6971 4.46195 21.2108C4 20.9133 4 20.1575 4 18.6458Z"/><path d="M11 11H8"/><path d="M14 7L8 7"/>',
    "coins": '<ellipse cx="15.5" cy="11" rx="6.5" ry="2"/><path d="M22 15.5C22 16.6046 19.0899 17.5 15.5 17.5C11.9101 17.5 9 16.6046 9 15.5"/><path d="M22 11V19.8C22 21.015 19.0899 22 15.5 22C11.9101 22 9 21.015 9 19.8V11"/><ellipse cx="8.5" cy="4" rx="6.5" ry="2"/><path d="M6 11C4.10819 10.7698 2.36991 10.1745 2 9M6 16C4.10819 15.7698 2.36991 15.1745 2 14"/><path d="M6 21C4.10819 20.7698 2.36991 20.1745 2 19L2 4"/><path d="M15 6V4"/>',
    "sale_tag": '<path d="M17.5 5C18.3284 5 19 5.67157 19 6.5C19 7.32843 18.3284 8 17.5 8C16.6716 8 16 7.32843 16 6.5C16 5.67157 16.6716 5 17.5 5Z"/><path d="M2.77423 11.1439C1.77108 12.2643 1.7495 13.9546 2.67016 15.1437C4.49711 17.5033 6.49674 19.5029 8.85633 21.3298C10.0454 22.2505 11.7357 22.2289 12.8561 21.2258C15.8979 18.5022 18.6835 15.6559 21.3719 12.5279C21.6377 12.2187 21.8039 11.8397 21.8412 11.4336C22.0062 9.63798 22.3452 4.46467 20.9403 3.05974C19.5353 1.65481 14.362 1.99377 12.5664 2.15876C12.1603 2.19608 11.7813 2.36233 11.472 2.62811C8.34412 5.31646 5.49781 8.10211 2.77423 11.1439Z"/>',
    "wallet": '<path d="M14 3H5C3.89543 3 3 3.89543 3 5C3 6.10457 3.89543 7 5 7H18C18 6.07003 18 5.60504 17.8978 5.22354C17.6204 4.18827 16.8117 3.37962 15.7765 3.10222C15.395 3 14.93 3 14 3Z"/><path d="M3 5V15C3 17.8284 3 19.2426 3.87868 20.1213C4.75736 21 6.17157 21 9 21H15C17.8284 21 19.2426 21 20.1213 20.1213C21 19.2426 21 17.8284 21 15V13C21 10.1716 21 8.75736 20.1213 7.87868C19.2426 7 17.8284 7 15 7H7"/><path d="M21 12H19C18.535 12 18.3025 12 18.1118 12.0511C17.5941 12.1898 17.1898 12.5941 17.0511 13.1118C17 13.3025 17 13.535 17 14C17 14.465 17 14.6975 17.0511 14.8882C17.1898 15.4059 17.5941 15.8102 18.1118 15.9489C18.3025 16 18.535 16 19 16H21"/>',
    "lock": '<path d="M4.26781 18.8447C4.49269 20.515 5.87613 21.8235 7.55966 21.9009C8.97627 21.966 10.4153 22 12 22C13.5847 22 15.0237 21.966 16.4403 21.9009C18.1239 21.8235 19.5073 20.515 19.7322 18.8447C19.879 17.7547 20 16.6376 20 15.5C20 14.3624 19.879 13.2453 19.7322 12.1553C19.5073 10.485 18.1239 9.17649 16.4403 9.09909C15.0237 9.03397 13.5847 9 12 9C10.4153 9 8.97627 9.03397 7.55966 9.09909C5.87613 9.17649 4.49269 10.485 4.26781 12.1553C4.12105 13.2453 4 14.3624 4 15.5C4 16.6376 4.12105 17.7547 4.26781 18.8447Z"/><path d="M7.5 9V6.5C7.5 4.01472 9.51472 2 12 2C14.4853 2 16.5 4.01472 16.5 6.5V9"/><path d="M16 15.49V15.5"/><path d="M12 15.49V15.5"/><path d="M8 15.49V15.5"/>',
    "agreement": '<path d="M22 6.75003H19.2111C18.61 6.75003 18.3094 6.75003 18.026 6.66421C17.7426 6.5784 17.4925 6.41168 16.9923 6.07823C16.2421 5.57806 15.3862 5.00748 14.961 4.87875C14.5359 4.75003 14.085 4.75003 13.1833 4.75003C11.9571 4.75003 11.1667 4.75003 10.6154 4.97839C10.0641 5.20675 9.63056 5.6403 8.76347 6.50739L8.00039 7.27047C7.80498 7.46588 7.70727 7.56359 7.64695 7.66005C7.42335 8.01764 7.44813 8.47708 7.70889 8.80854C7.77924 8.89796 7.88689 8.98459 8.10218 9.15785C8.89796 9.79827 10.0452 9.73435 10.7658 9.00945L12 7.76789H13L19 13.8036C19.5523 14.3592 19.5523 15.2599 19 15.8155C18.4477 16.3711 17.5523 16.3711 17 15.8155L16.5 15.3125M13.5 12.2947L16.5 15.3125M16.5 15.3125C17.0523 15.8681 17.0523 16.7689 16.5 17.3244C15.9477 17.88 15.0523 17.88 14.5 17.3244L13.5 16.3185M13.5 16.3185C14.0523 16.874 14.0523 17.7748 13.5 18.3304C12.9477 18.8859 12.0523 18.8859 11.5 18.3304L10 16.8214M13.5 16.3185L11.5 14.3185M9.5 16.3185L10 16.8214M10 16.8214C10.5523 17.377 10.5523 18.2778 10 18.8334C9.44772 19.3889 8.55229 19.3889 8 18.8334L5.17637 15.9509C4.59615 15.3586 4.30604 15.0625 3.93435 14.9062C3.56266 14.75 3.14808 14.75 2.31894 14.75H2"/><path d="M22 14.75H19.5"/><path d="M8.5 6.75003L2 6.75003"/>',
    "mail_open": '<path d="M5.00035 7L3.78154 7.81253C2.90783 8.39501 2.47097 8.68625 2.23422 9.13041C1.99747 9.57457 1.99923 10.0966 2.00273 11.1406C2.00696 12.3975 2.01864 13.6782 2.05099 14.9741C2.12773 18.0487 2.16611 19.586 3.29651 20.7164C4.42691 21.8469 5.98497 21.8858 9.10108 21.9637C11.0397 22.0121 12.9611 22.0121 14.8996 21.9637C18.0158 21.8858 19.5738 21.8469 20.7042 20.7164C21.8346 19.586 21.873 18.0487 21.9497 14.9741C21.9821 13.6782 21.9937 12.3975 21.998 11.1406C22.0015 10.0966 22.0032 9.57456 21.7665 9.13041C21.5297 8.68625 21.0929 8.39501 20.2191 7.81253L19.0003 7"/><path d="M2 10L8.91302 14.1478C10.417 15.0502 11.169 15.5014 12 15.5014C12.831 15.5014 13.583 15.0502 15.087 14.1478L22 10"/><path d="M4.99998 12V6C4.99998 4.11438 4.99998 3.17157 5.58577 2.58579C6.17156 2 7.11437 2 8.99998 2H15C16.8856 2 17.8284 2 18.4142 2.58579C19 3.17157 19 4.11438 19 6V12"/><path d="M10 10H14M10 6H14"/>',
    "clock": '<path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"/><path d="M12 8V12L14.5 14.5"/>',
    "users": '<path d="M12 15C14.2091 15 16 13.2091 16 11C16 8.79086 14.2091 7 12 7C9.79086 7 8 8.79086 8 11C8 13.2091 9.79086 15 12 15Z"/><path d="M4.5 21C5.5 17.5 8.5 16 12 16C15.5 16 18.5 17.5 19.5 21"/>',
    "headset": '<path d="M4 13V12C4 7.58172 7.58172 4 12 4C16.4183 4 20 7.58172 20 12V13"/><path d="M20 15V13H17.5V18H20ZM20 18C20 19.5 19 20.5 17.5 20.5H14.5M4 13H6.5V18H4V13Z"/><path d="M6.5 13V18"/><path d="M17.5 13V18"/>',
    "calendar": '<path d="M8 4H16C18.5 4 20 5.5 20 8V16C20 18.5 18.5 20 16 20H8C5.5 20 4 18.5 4 16V8C4 5.5 5.5 4 8 4Z"/><path d="M8 2.5V5.5M16 2.5V5.5M4 9.5H20"/>',
    "pdf": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
    "alert": '<path d="M12 8V13"/><path d="M12 16.5V17"/><circle cx="12" cy="12" r="10"/>',
    "car": '<path d="M5 13L6.4 8.2C6.9 6.9 7.7 6.5 9 6.5H15C16.3 6.5 17.1 6.9 17.6 8.2L19 13M5 13H19M5 13C4 13 3.5 13.6 3.5 14.5V17.5H5.5M19 13C20 13 20.5 13.6 20.5 14.5V17.5H18.5M5.5 17.5V19M18.5 17.5V19M5.5 17.5H18.5"/><path d="M7 15.5H8.5M15.5 15.5H17"/>',
}


def icon(name: str, size: int, color: str) -> str:
    body = ICONS.get(name, ICONS["shield"])
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="{size}" '
        f'height="{size}" fill="none" stroke="{color}" stroke-width="1.5" '
        f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{body}</svg>'
    )


def esc(v) -> str:
    return html.escape(str(v), quote=True)


# ── Layout pieces ────────────────────────────────────────────────────────────
CSS = f"""
      body {{ margin: 0; padding: 0; -webkit-text-size-adjust: 100% !important; -ms-text-size-adjust: 100% !important; -webkit-font-smoothing: antialiased !important; }}
      img {{ border: 0 !important; outline: none !important; }}
      a {{ text-decoration: none; }}
      @media only screen and (max-width:659px) {{
        .em_main_table {{ width: 481px !important; }}
        .em_side20 {{ width: 20px !important; }}
        .em_f3236 {{ font-size: 32px !important; line-height: 36px !important; }}
        .em_f1620 {{ font-size: 16px !important; line-height: 21px !important; }}
        .em_pp {{ padding: 45px 24px 0 24px !important; }}
        .em_btn a {{ display: block !important; text-align: center !important; }}
      }}
      @media only screen and (max-width:480px) {{
        .em_main_table {{ width: 390px !important; }}
        .em_side20 {{ width: 19px !important; }}
      }}
      @media only screen and (max-width:389px) {{
        .em_main_table {{ width: 320px !important; }}
        .em_side20 {{ width: 10px !important; }}
        .em_f3236 {{ font-size: 27px !important; line-height: 31px !important; }}
      }}
      @media screen and (prefers-color-scheme: dark) {{
        .em_dm_txt_white {{ color: #FFFFFF !important; }}
        .em_dm_txt_white a {{ color: #FFFFFF !important; }}
        .em_full_wrap, .em_body {{ background-color: {DARK_PAGE} !important; color: #ffffff !important; }}
        .em_main_table {{ background-color: {DARK_CARD} !important; color: #ffffff !important; }}
        .em_dm_dark {{ background-color: {NAVY_DARK} !important; }}
        .em_body_txt, .em_body_txt a {{ color: #E7EDF7 !important; }}
        .em_head_txt {{ color: #FFFFFF !important; }}
        .em_border3 {{ border-bottom: 1px solid #ffffff !important; }}
      }}
"""


def logo_header() -> str:
    return f"""
                        <!--header-->
                        <tr>
                          <td align="center" valign="top" style="mso-line-height-rule: exactly;">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0" align="center" role="presentation" style="mso-table-lspace: 0px; mso-table-rspace: 0px;">
                              <tbody>
                                <tr>
                                  <td class="em_side20" style="width: 48px; mso-line-height-rule: exactly;" width="48"></td>
                                  <td align="left" valign="middle" style="mso-line-height-rule: exactly;">
                                    <table border="0" cellspacing="0" cellpadding="0" role="presentation" style="mso-table-lspace: 0px; mso-table-rspace: 0px;">
                                      <tbody>
                                        <tr>
                                          <td height="40" style="height: 40px; font-size: 1px; line-height: 1px; mso-line-height-rule: exactly;">&nbsp;</td>
                                        </tr>
                                        <tr>
                                          <td align="left" valign="bottom" style="font-size: 0; line-height: 0; mso-line-height-rule: exactly;">
                                            <a href="{PORTAL_URL}" target="_blank" style="text-decoration: none; mso-line-height-rule: exactly;">
                                              <img src="{LOGO_URL}" width="140" alt="Protecta Bode" style="display: block; font-family: Arial, sans-serif; font-size: 16px; line-height: 20px; font-weight: bold; color: {NAVY}; max-width: 140px; outline: none !important; border-width: 0;" border="0" />
                                            </a>
                                          </td>
                                          <td align="right" valign="bottom" class="em_dm_txt_white" style="padding-left: 16px; color: {MUTED}; font-family: {FONT_BODY}; font-size: 11px; line-height: 14px; letter-spacing: .08em; text-transform: uppercase; mso-line-height-rule: exactly;">by Liberty&nbsp;Uganda</td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </td>
                                  <td class="em_side20" style="width: 48px; mso-line-height-rule: exactly;" width="48">&nbsp;</td>
                                </tr>
                              </tbody>
                            </table>
                          </td>
                        </tr>"""


def icon_title(icon_name: str, title: str) -> str:
    return f"""
                        <!--sec: title-->
                        <tr>
                          <td align="center" valign="top" style="mso-line-height-rule: exactly;">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0" align="center" role="presentation" style="mso-table-lspace: 0px; mso-table-rspace: 0px;">
                              <tbody>
                                <tr>
                                  <td class="em_side20" style="width: 48px; mso-line-height-rule: exactly;" width="48">&nbsp;</td>
                                  <td align="left" valign="top" style="mso-line-height-rule: exactly;">
                                    <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation" style="mso-table-lspace: 0px; mso-table-rspace: 0px;">
                                      <tbody>
                                        <tr>
                                          <td height="52" style="height: 52px; font-size: 1px; line-height: 1px; mso-line-height-rule: exactly;">&nbsp;</td>
                                        </tr>
                                        <tr>
                                          <td align="left" valign="top" style="font-size: 0; line-height: 0; mso-line-height-rule: exactly;">{icon(icon_name, 56, ORANGE)}</td>
                                        </tr>
                                        <tr>
                                          <td height="26" style="height: 26px; font-size: 1px; line-height: 1px; mso-line-height-rule: exactly;">&nbsp;</td>
                                        </tr>
                                        <tr>
                                          <td align="left" class="em_head_txt em_f3236" style="font-size: 40px; line-height: 44px; font-weight: 600; color: {NAVY}; font-family: {FONT_DISPLAY}; letter-spacing: -0.2px; mso-line-height-rule: exactly;" valign="middle">{esc(title)}</td>
                                        </tr>
                                        <tr>
                                          <td height="14" style="height: 14px; font-size: 0; line-height: 0; mso-line-height-rule: exactly;">&nbsp;</td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </td>
                                  <td class="em_side20" style="width: 48px; mso-line-height-rule: exactly;" width="48">&nbsp;</td>
                                </tr>
                              </tbody>
                            </table>
                          </td>
                        </tr>"""


def _para_td() -> str:
    return f'align="left" class="em_body_txt em_f1620" style="font-size: 18px; line-height: 23px; font-weight: 400; color: {INK}; font-family: {FONT_BODY}; letter-spacing: 0.1px; mso-line-height-rule: exactly;"'


def section(body_html: str, top_gap: int = 0) -> str:
    return f"""
                        <!--sec: body-->
                        <tr>
                          <td align="center" valign="top" style="mso-line-height-rule: exactly;">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0" align="center" role="presentation" style="mso-table-lspace: 0px; mso-table-rspace: 0px;">
                              <tbody>
                                <tr>
                                  <td class="em_side20" style="width: 48px; mso-line-height-rule: exactly;" width="48">&nbsp;</td>
                                  <td align="left" valign="top" style="mso-line-height-rule: exactly;">
                                    <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation" style="mso-table-lspace: 0px; mso-table-rspace: 0px;">
                                      <tbody>
                                        <tr><td height="{top_gap}" style="height: {top_gap}px; font-size: 1px; line-height: 1px; mso-line-height-rule: exactly;">&nbsp;</td></tr>
                                        {body_html}
                                        <tr><td height="52" style="height: 52px; font-size: 1px; line-height: 1px; mso-line-height-rule: exactly;">&nbsp;</td></tr>
                                      </tbody>
                                    </table>
                                  </td>
                                  <td class="em_side20" style="width: 48px; mso-line-height-rule: exactly;" width="48">&nbsp;</td>
                                </tr>
                              </tbody>
                            </table>
                          </td>
                        </tr>"""


def paragraphs(items: list[str]) -> str:
    rows = []
    for i, text in enumerate(items):
        gap = '<tr><td height="18" style="height: 18px; font-size: 1px; line-height: 1px; mso-line-height-rule: exactly;">&nbsp;</td></tr>' if i else ""
        rows.append(f'{gap}<tr><td {_para_td()} valign="middle">{text}</td></tr>')
    return "".join(rows)


def signoff(who: str = "The Protecta Bode team<br />Liberty General Insurance Uganda") -> str:
    return f'<tr><td {_para_td()} valign="middle">Best regards,<br />{who}</td></tr>'


def bullets(items: list[str]) -> str:
    lis = "".join(
        f'<li style="margin: 0 0 10px; padding: 0 0 0 6px;">{it}</li>' for it in items
    )
    return (
        f'<tr><td align="left" class="em_body_txt em_f1620" style="font-size: 17px; line-height: 22px; color: {INK}; '
        f'font-family: {FONT_BODY}; mso-line-height-rule: exactly;"><ul style="margin: 0; padding-left: 20px;">{lis}</ul></td></tr>'
    )


def detail_rows(rows: list[tuple[str, str]], header: str | None = None) -> str:
    out = []
    if header:
        out.append(
            f'<tr><td colspan="2" align="left" class="em_head_txt" style="padding-bottom: 12px; font-family: {FONT_DISPLAY}; '
            f'font-size: 15px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: {MUTED}; '
            f'mso-line-height-rule: exactly;">{esc(header)}</td></tr>'
        )
    for label, value in rows:
        out.append(
            f'<tr>'
            f'<td align="left" valign="top" style="padding: 6px 18px 6px 0; border-top: 1px solid {LINE}; color: {MUTED}; font-family: {FONT_BODY}; font-size: 15px; line-height: 21px; mso-line-height-rule: exactly;">{label}</td>'
            f'<td align="right" valign="top" style="padding: 6px 0; border-top: 1px solid {LINE}; color: {NAVY}; font-family: {FONT_BODY}; font-size: 15px; font-weight: 700; line-height: 21px; mso-line-height-rule: exactly;">{value}</td>'
            f'</tr>'
        )
    return (
        '<tr><td height="8" style="height: 8px; font-size: 1px; line-height: 1px;">&nbsp;</td></tr>'
        '<tr><td align="left" valign="top"><table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">'
        f'<tbody>{"".join(out)}</tbody></table></td></tr>'
    )


def line_items(items: list[tuple[str, str, str, str]],
               totals: list[tuple[str, str, bool]] | None = None,
               repeat_tag: str = "line_items") -> str:
    """Invoice-style items table. The row between the REPEAT markers is repeated
    by the email service once per line item; the tuples below are preview rows."""
    head = (
        f'<tr>'
        f'<td align="left" style="padding: 8px 8px 8px 0; border-bottom: 2px solid {NAVY}; font-family: {FONT_DISPLAY}; font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: {NAVY};">Description</td>'
        f'<td align="right" style="padding: 8px 0; border-bottom: 2px solid {NAVY}; font-family: {FONT_DISPLAY}; font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: {NAVY};">Qty</td>'
        f'<td align="right" style="padding: 8px 8px; border-bottom: 2px solid {NAVY}; font-family: {FONT_DISPLAY}; font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: {NAVY};">Unit (UGX)</td>'
        f'<td align="right" style="padding: 8px 0; border-bottom: 2px solid {NAVY}; font-family: {FONT_DISPLAY}; font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: {NAVY};">Amount (UGX)</td>'
        f'</tr>'
    )
    rows = "".join(
        f'<tr>'
        f'<td align="left" style="padding: 9px 8px 9px 0; border-bottom: 1px solid {LINE}; color: {INK}; font-family: {FONT_BODY}; font-size: 14.5px; line-height: 20px;">{desc}</td>'
        f'<td align="right" style="padding: 9px 0; border-bottom: 1px solid {LINE}; color: {INK}; font-family: {FONT_BODY}; font-size: 14.5px;">{qty}</td>'
        f'<td align="right" style="padding: 9px 8px; border-bottom: 1px solid {LINE}; color: {INK}; font-family: {FONT_BODY}; font-size: 14.5px;">{unit}</td>'
        f'<td align="right" style="padding: 9px 0; border-bottom: 1px solid {LINE}; color: {NAVY}; font-family: {FONT_BODY}; font-size: 14.5px; font-weight: 700;">{amount}</td>'
        f'</tr>'
        for desc, qty, unit, amount in items
    )
    total_rows = ""
    for label, value, strong in (totals or []):
        total_rows += (
            f'<tr>'
            f'<td colspan="3" align="right" style="padding: {"12px" if strong else "7px"} 8px {"6px" if strong else "7px"} 0; {"border-top: 2px solid " + NAVY + ";" if strong else ""} color: {NAVY if strong else MUTED}; font-family: {FONT_DISPLAY if strong else FONT_BODY}; font-size: {17 if strong else 14.5}px; font-weight: {600 if strong else 400};">{label}</td>'
            f'<td align="right" style="padding: {"12px" if strong else "7px"} 0 {"6px" if strong else "7px"}; {"border-top: 2px solid " + NAVY + ";" if strong else ""} color: {NAVY}; font-family: {FONT_DISPLAY if strong else FONT_BODY}; font-size: {19 if strong else 14.5}px; font-weight: {600 if strong else 400};">{value}</td>'
            f'</tr>'
        )
    return (
        '<tr><td height="8" style="height: 8px; font-size: 1px; line-height: 1px;">&nbsp;</td></tr>'
        '<tr><td align="left" valign="top">'
        f'<table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">'
        f'<tbody>{head}<!-- REPEAT:{repeat_tag} -->{rows}<!-- /REPEAT:{repeat_tag} -->{total_rows}</tbody>'
        '</table></td></tr>'
    )


def cta(label: str, url: str, note: str | None = None) -> str:
    note_row = (
        f'<tr><td height="14" style="height: 14px; font-size: 1px; line-height: 1px;">&nbsp;</td></tr>'
        f'<tr><td align="left" class="em_body_txt" style="font-size: 13px; line-height: 18px; color: {MUTED}; font-family: {FONT_BODY}; mso-line-height-rule: exactly;">{note}</td></tr>'
        if note else ""
    )
    return f"""
                                        <tr>
                                          <td height="26" style="height: 26px; font-size: 1px; line-height: 1px; mso-line-height-rule: exactly;">&nbsp;</td>
                                        </tr>
                                        <tr>
                                          <td align="left" class="em_btn" valign="top" style="mso-line-height-rule: exactly;">
                                            <table border="0" cellspacing="0" cellpadding="0" role="presentation" style="mso-table-lspace: 0px; mso-table-rspace: 0px;">
                                              <tbody>
                                                <tr>
                                                  <td align="center" bgcolor="{ORANGE}" style="border-radius: 12px; mso-line-height-rule: exactly;">
                                                    <a href="{url}" target="_blank" style="display: inline-block; padding: 15px 30px; font-family: {FONT_DISPLAY}; font-size: 16px; font-weight: 600; line-height: 20px; color: #ffffff; border-radius: 12px; text-decoration: none; mso-line-height-rule: exactly;">{esc(label)}</a>
                                                  </td>
                                                </tr>
                                              </tbody>
                                            </table>
                                          </td>
                                        </tr>{note_row}"""


def reference_box(label: str, value: str) -> str:
    return f"""
                                        <tr>
                                          <td height="24" style="height: 24px; font-size: 1px; line-height: 1px; mso-line-height-rule: exactly;">&nbsp;</td>
                                        </tr>
                                        <tr>
                                          <td align="left" valign="top" style="mso-line-height-rule: exactly;">
                                            <table border="0" cellspacing="0" cellpadding="0" role="presentation" style="mso-table-lspace: 0px; mso-table-rspace: 0px;">
                                              <tbody>
                                                <tr>
                                                  <td align="left" style="border: 1.5px dashed {ORANGE}; border-radius: 12px; padding: 12px 20px; font-family: {FONT_BODY}; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: {MUTED}; line-height: 18px; mso-line-height-rule: exactly;">{esc(label)}<br />
                                                    <strong style="font-family: {FONT_DISPLAY}; font-size: 20px; letter-spacing: .04em; color: {NAVY}; text-transform: none;">{esc(value)}</strong>
                                                  </td>
                                                </tr>
                                              </tbody>
                                            </table>
                                          </td>
                                        </tr>"""


def footer() -> str:
    return f"""
                        <!--footer-->
                        <tr>
                          <td align="center" valign="top" style="mso-line-height-rule: exactly;">
                            <table align="center" border="0" cellpadding="0" cellspacing="0" class="em_wrapper" width="660" style="width: 660px; mso-table-lspace: 0px; mso-table-rspace: 0px;" role="presentation">
                              <tbody>
                                <tr>
                                  <td align="center" valign="top" style="mso-line-height-rule: exactly;">
                                    <table width="100%" border="0" cellspacing="0" cellpadding="0" align="center" role="presentation" style="mso-table-lspace: 0px; mso-table-rspace: 0px;">
                                      <tbody>
                                        <tr>
                                          <td bgcolor="{NAVY}" align="center" valign="top" class="em_dm_dark" style="mso-line-height-rule: exactly;">
                                            <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation" style="mso-table-lspace: 0px; mso-table-rspace: 0px;">
                                              <tr>
                                                <td align="center" valign="top" style="mso-line-height-rule: exactly; padding: 52px 48px 0;" class="em_pp">
                                                  <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation" style="mso-table-lspace: 0px; mso-table-rspace: 0px;">
                                                    <tr>
                                                      <td align="left" valign="top" style="padding-top: 6px; font-size: 0; line-height: 0; mso-line-height-rule: exactly;">
                                                        <table border="0" cellspacing="0" cellpadding="0" role="presentation"><tr>
                                                          <td valign="middle" style="padding-right: 10px; font-size: 0; line-height: 0;"><img src="../assets/umbrella-white.png" width="24" height="24" alt="" style="display: block; border: 0; outline: none;" /></td>
                                                          <td valign="middle" class="em_dm_txt_white" style="color: #ffffff; font-family: {FONT_DISPLAY}; font-size: 22px; font-weight: 600; line-height: 27px; white-space: nowrap;">Protecta <span style="font-weight: 400;">Bode</span></td>
                                                        </tr></table>
                                                      </td>
                                                    </tr>
                                                    <tr>
                                                      <td align="left" valign="top" class="em_dm_txt_white" style="color: {PAGE}; font-family: {FONT_DISPLAY}; font-size: 18px; font-weight: 600; line-height: 22px; padding-top: 40px; mso-line-height-rule: exactly;">Need help?</td>
                                                    </tr>
                                                    <tr>
                                                      <td align="left" valign="top" style="padding-top: 14px; padding-bottom: 34px; border-bottom: 1px solid rgba(249,247,242,.35); mso-line-height-rule: exactly;">
                                                        <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation" style="mso-table-lspace: 0px; mso-table-rspace: 0px;">
                                                          <tr>
                                                            <td class="em_dm_txt_white" align="left" valign="top" style="color: {PAGE}; font-family: {FONT_BODY}; font-size: 15px; line-height: 26px; mso-line-height-rule: exactly;">
                                                              <span style="font-size: 12px; line-height: 15px; opacity: .75;">Call us</span><br />
                                                              <a href="{PHONE_HREF}" target="_blank" style="color: #ffffff; text-decoration: none; font-weight: 700;">{PHONE}</a>
                                                              &nbsp;&nbsp;·&nbsp;&nbsp;
                                                              <span style="font-size: 12px; line-height: 15px; opacity: .75;">WhatsApp</span><br style="display:none" />
                                                              <a href="{WHATSAPP_HREF}" target="_blank" style="color: #ffffff; text-decoration: none; font-weight: 700;">{WHATSAPP}</a>
                                                              &nbsp;&nbsp;·&nbsp;&nbsp;
                                                              <span style="font-size: 12px; line-height: 15px; opacity: .75;">Email</span><br style="display:none" />
                                                              <a href="mailto:{EMAIL_ADDR}" style="color: #ffffff; text-decoration: none; font-weight: 700;">{EMAIL_ADDR}</a>
                                                            </td>
                                                          </tr>
                                                        </table>
                                                      </td>
                                                    </tr>
                                                    <tr>
                                                      <td height="34" style="height: 34px; mso-line-height-rule: exactly;">&nbsp;</td>
                                                    </tr>
                                                    <tr>
                                                      <td class="em_dm_txt_white" align="left" valign="top" style="color: {PAGE}; font-family: {FONT_BODY}; font-size: 11px; font-weight: 400; line-height: 15px; mso-line-height-rule: exactly;">
                                                        <a href="{PORTAL_URL}/support" target="_blank" rel="noopener" style="color: #ffffff; text-decoration: none;">Support Centre</a>
                                                        &nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;
                                                        <a href="{PORTAL_URL}/terms" target="_blank" rel="noopener" style="color: #ffffff; text-decoration: none;">Terms &amp; Conditions</a>
                                                        &nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;
                                                        <a href="{PORTAL_URL}/privacy" target="_blank" rel="noopener" style="color: #ffffff; text-decoration: none;">Privacy Notice</a>
                                                        &nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;
                                                        <a href="https://www.liberty.co.ug" target="_blank" rel="noopener" style="color: #ffffff; text-decoration: none;">liberty.co.ug</a>
                                                      </td>
                                                    </tr>
                                                    <tr>
                                                      <td class="em_dm_txt_white" align="left" valign="top" style="color: {PAGE}; font-family: {FONT_BODY}; font-size: 10px; font-weight: 400; line-height: 14px; padding-top: 14px; opacity: .85; mso-line-height-rule: exactly;">
                                                        Protecta Bode is underwritten by Liberty General Insurance Uganda and powered by Stanbic Bancassurance Agency and Safeboda, regulated under the Insurance Regulatory Authority (IRA) sandbox guidelines. Terms and Conditions apply. Cover is subject to policy wording, limits and exclusions; repairs are carried out at Liberty-approved garages.
                                                      </td>
                                                    </tr>
                                                    <tr>
                                                      <td class="em_dm_txt_white" align="left" valign="top" style="color: {PAGE}; font-family: {FONT_BODY}; font-size: 10px; font-weight: 400; line-height: 14px; padding-top: 10px; opacity: .85; mso-line-height-rule: exactly;">
                                                        This email and any attachments are confidential and intended for the named recipient only. Please do not reply to this email - the inbox is not monitored. For help, call {PHONE} or email {EMAIL_ADDR}.
                                                      </td>
                                                    </tr>
                                                    <tr>
                                                      <td class="em_dm_txt_white" align="left" valign="top" style="color: {PAGE}; font-family: {FONT_BODY}; font-size: 10px; font-weight: 400; line-height: 14px; padding-top: 10px; opacity: .85; mso-line-height-rule: exactly;">
                                                        &copy; {{{{year}}}} Liberty General Insurance Uganda Ltd. 3rd Floor, Madhvani Building, Plot 99-101 Buganda Road, Kampala, Uganda. P.O. Box 22938, Kampala. All rights reserved. You are receiving this email because you have a Protecta Bode relationship with Liberty General Insurance Uganda. <a href="{{{{unsubscribe_url}}}}" style="color: #ffffff; text-decoration: underline;">Unsubscribe</a> from marketing emails.
                                                      </td>
                                                    </tr>
                                                    <tr>
                                                      <td height="46" style="height: 46px; mso-line-height-rule: exactly;">&nbsp;</td>
                                                    </tr>
                                                  </table>
                                                </td>
                                              </tr>
                                            </table>
                                          </td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </td>
                        </tr>"""


def render_email(*, title: str, preheader: str, icon_name: str, heading: str,
                 sections: list[str]) -> str:
    body_sections = "".join(sections)
    return f"""<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:v="urn:schemas-microsoft-com:vml" style="color-scheme: light dark; supported-color-schemes: light dark;">
  <head>
    <!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
    <title>{esc(title)}</title>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="format-detection" content="telephone=no" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&family=Noto+Sans:wght@400;700&display=swap" rel="stylesheet" />
    <style>{CSS}
    </style>
  </head>
  <body bgcolor="{PAGE}" class="em_body" style="-webkit-text-size-adjust: 100% !important; -ms-text-size-adjust: 100% !important; -webkit-font-smoothing: antialiased !important; margin: 0px auto; padding: 0px;">
    <div style="display:none !important;visibility:hidden;mso-hide:all;font-size:1px;color:{PAGE};line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">{esc(preheader)}</div>
    <table bgcolor="{PAGE}" border="0" cellpadding="0" cellspacing="0" class="em_full_wrap" style="table-layout: fixed; mso-table-lspace: 0px; mso-table-rspace: 0px;" width="100%" role="presentation">
      <tbody>
        <tr>
          <td align="center" valign="top" style="mso-line-height-rule: exactly;">
            <table align="center" bgcolor="{WHITE}" border="0" cellpadding="0" cellspacing="0" class="em_main_table" style="width: 660px; table-layout: fixed; mso-table-lspace: 0px; mso-table-rspace: 0px;" width="660" role="presentation">
              <tbody>
                <tr>
                  <td align="center" valign="top" style="mso-line-height-rule: exactly;">
                    <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="mso-table-lspace: 0px; mso-table-rspace: 0px;">
                      <tbody>
{logo_header()}
{icon_title(icon_name, heading)}
{body_sections}
{footer()}
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
        <tr><td height="40" style="height: 40px; font-size: 1px; line-height: 1px;">&nbsp;</td></tr>
      </tbody>
    </table>
  </body>
</html>
"""


def sec(content: str) -> str:
    return section(content)


# ── Templates ────────────────────────────────────────────────────────────────
TEMPLATES: list[dict] = []

def template(name, audience, subject, preheader, icon_name, heading, sections):
    TEMPLATES.append(dict(name=name, audience=audience, subject=subject,
                          preheader=preheader, icon_name=icon_name,
                          heading=heading, sections=sections))


P = paragraphs  # shorthand


# ══ CUSTOMER ══════════════════════════════════════════════════════════════════
template(
    "welcome", "Customer",
    "Welcome to Protecta Bode - cover your ride, cover your life",
    "Your Protecta Bode account is ready. Car body, third-party and driver cover from 1.5% of your car's value.",
    "shield", "Welcome to Protecta Bode",
    lambda: [
        sec(P(["Hi {{first_name}},", "Thank you for joining <strong>Protecta Bode</strong> - the smart, affordable micro-motor policy from Liberty General Insurance Uganda. For just <strong>1.5% of your car's value</strong>, you enjoy car body, third-party and driver cover in case of an accident."])),
        sec(bullets([
            "<strong>Car body cover</strong> - dents, scratches, accidental damage, theft of parts, windscreens &amp; lights, and repairs at Liberty-approved garages.",
            "<strong>Third-party protection</strong> - liability for bodily injury, death and property damage arising from an accident involving your vehicle, with combined limits per incident.",
            "<strong>Driver cover</strong> - medical treatment and personal accident benefits up to the policy limit.",
        ])),
        sec(P(["Your account is ready. Get a quote in under three minutes - on the portal or on WhatsApp - and pay with MTN MoMo, Airtel Money or bank transfer."]) + cta("Get my first quote", "{{portal_url}}/quote", "Questions? Call " + PHONE + " or WhatsApp " + WHATSAPP + ".") ),
    ],
)

template(
    "quote", "Customer",
    "Your Protecta Bode quote - {{premium_ugx}}/year",
    "Your quote for {{vehicle}} is ready. Complete payment to activate your cover.",
    "invoice", "Your quote is ready",
    lambda: [
        sec(P(["Hi {{first_name}},", "Here is your Protecta Bode quote for <strong>{{vehicle}}</strong>. It is held for you until <strong>{{quote_expires}}</strong>."])),
        sec(detail_rows([
            ("Vehicle", "{{vehicle}}"),
            ("Number plate", "{{plate}}"),
            ("Car value", "{{value_ugx}}"),
            ("Rate", "1.5% of value"),
            ("Cover", "Car body · Third party · Driver"),
        ], header="Quote summary") + detail_rows([("Annual premium", "<strong style=\"font-size:18px;\">{{premium_ugx}}</strong>")]) + reference_box("Quote reference", "{{quote_ref}}")),
        sec(P(["Payment is quick: MTN MoMo, Airtel Money or bank transfer. Your policy documents are issued automatically the moment payment is confirmed."]) + cta("Pay & activate cover", "{{pay_url}}")),
    ],
)

template(
    "payment-receipt", "Customer",
    "Payment received - {{amount_ugx}} for {{plate}}",
    "We have received your Protecta Bode payment. Your policy is being issued.",
    "coins", "Payment received",
    lambda: [
        sec(P(["Hi {{first_name}},", "Thank you - we have received your payment for <strong>{{vehicle}}</strong>. Your policy and motor certificate are on their way."])),
        sec(detail_rows([
            ("Receipt no.", "{{receipt_no}}"),
            ("Amount", "{{amount_ugx}}"),
            ("Method", "{{payment_method}}"),
            ("Reference", "{{payment_ref}}"),
            ("Date", "{{payment_date}}"),
        ], header="Payment details")),
        sec(P(["This receipt is for your records. Keep it with your policy documents - you can also download both any time from your portal."]) + cta("Open my portal", "{{portal_url}}/policies")),
    ],
)

template(
    "policy-issued", "Customer",
    "You're covered - policy {{policy_no}} is active",
    "Your Protecta Bode policy is active. Documents attached. Cover your ride, cover your life.",
    "shield", "You're covered",
    lambda: [
        sec(P(["Hi {{first_name}},", "Great news - your Protecta Bode cover is <strong>active</strong>. Your policy schedule and motor certificate are attached to this email as PDFs."])),
        sec(detail_rows([
            ("Policy number", "{{policy_no}}"),
            ("Vehicle", "{{vehicle}}"),
            ("Number plate", "{{plate}}"),
            ("Cover", "Car body · Third party · Driver"),
            ("Cover from", "{{period_start}}"),
            ("Renews on", "{{period_end}}"),
            ("Annual premium", "{{premium_ugx}}"),
        ], header="Policy summary") ),
        sec(P(["If anything happens on the road, report a claim from your portal or WhatsApp within 24 hours - you'll need a fully filled claim form (we provide it), a police report where applicable, and treatment notes and medical bills for driver cover claims."]) + cta("View my policy", "{{portal_url}}/policies/{{policy_no}}", "Save this email - it is proof of purchase until your documents arrive separately.")),
    ],
)

template(
    "payment-failed", "Customer",
    "Action needed - your Protecta Bode payment didn't go through",
    "Your MTN MoMo / Airtel Money payment for {{plate}} did not complete. Try again to keep your quote price.",
    "alert", "Payment didn't go through",
    lambda: [
        sec(P(["Hi {{first_name}},", "We tried to collect <strong>{{amount_ugx}}</strong> from your <strong>{{payment_method}}</strong>, but the payment did not complete (reason: <strong>{{failure_reason}}</strong>). No money has left your account."])),
        sec(detail_rows([
            ("Vehicle", "{{vehicle}}"),
            ("Number plate", "{{plate}}"),
            ("Amount due", "{{amount_ugx}}"),
            ("Quote reference", "{{quote_ref}}"),
        ], header="Pending payment")),
        sec(P(["Your quote is still held at today's price. Approve the next mobile money prompt when it comes, or retry now from your portal - it takes under a minute."]) + cta("Retry payment", "{{pay_url}}", "Bank transfer also accepted - details are in your portal under Payment methods.")),
    ],
)

template(
    "renewal-reminder", "Customer",
    "Your Protecta Bode cover expires in {{days}} days",
    "Policy {{policy_no}} for {{plate}} expires on {{period_end}}. Renew in two taps to stay covered.",
    "calendar", "Your cover expires soon",
    lambda: [
        sec(P(["Hi {{first_name}},", "Your Protecta Bode cover for <strong>{{vehicle}}</strong> (plate <strong>{{plate}}</strong>) expires on <strong>{{period_end}}</strong> - that's in <strong>{{days}} days</strong>."])),
        sec(detail_rows([
            ("Policy number", "{{policy_no}}"),
            ("Expires", "{{period_end}}"),
            ("Renewal premium", "{{renewal_ugx}}"),
        ], header="Renewal summary")),
        sec(P(["Renew before expiry so your car body, third-party and driver cover continue without a gap - it takes two taps and your details are already on file."]) + cta("Renew now", "{{renew_url}}", "Prefer WhatsApp? Reply RENEW to our official number and we'll take it from there.")),
    ],
)

template(
    "claim-acknowledged", "Customer",
    "Claim {{claim_ref}} received - we're on it",
    "We have received your claim for {{plate}}. Here is what happens next and the documents we'll need.",
    "headset", "We've received your claim",
    lambda: [
        sec(P(["Hi {{first_name}},", "Thank you for reporting the incident involving <strong>{{vehicle}}</strong>. Your claim has been registered and assigned reference <strong>{{claim_ref}}</strong>. Our claims team at Liberty General Insurance Uganda is on it."])),
        sec(detail_rows([
            ("Claim reference", "{{claim_ref}}"),
            ("Policy number", "{{policy_no}}"),
            ("Incident date", "{{incident_date}}"),
            ("What happened", "{{incident_summary}}"),
        ], header="Claim details")),
        sec(P(["<strong>What happens next</strong>"]) + bullets([
            "We acknowledge and assign your claim within one working day.",
            "An assessor reviews your vehicle and documents - repairs happen at Liberty-approved garages only.",
            "We keep you updated at every step by email and WhatsApp.",
        ]) + P(["<strong>Documents to prepare</strong>"]) + bullets([
            "Fully filled claim form (provided by Liberty).",
            "Police report, where applicable.",
            "Treatment notes and medical bills - for driver cover claims.",
            "Post-mortem report and death certificate - in case of fatality.",
            "LC1 letter, where required.",
        ])),
        sec(P(["You can upload documents and follow your claim's progress any time in the portal."]) + cta("Track my claim", "{{portal_url}}/claims/{{claim_ref}}", "Urgent? Call " + PHONE + " quoting your claim reference.")),
    ],
)

template(
    "claim-update", "Customer",
    "Update on claim {{claim_ref}} - {{claim_status}}",
    "There is an update on your Protecta Bode claim for {{plate}}.",
    "headset", "Your claim has an update",
    lambda: [
        sec(P(["Hi {{first_name}},", "Here is the latest on claim <strong>{{claim_ref}}</strong> for <strong>{{vehicle}}</strong>: <strong>{{claim_status_message}}</strong>"])),
        sec(detail_rows([
            ("Claim reference", "{{claim_ref}}"),
            ("Status", "{{claim_status}}"),
            ("Updated", "{{update_date}}"),
            ("Handler", "{{claim_handler}}"),
        ], header="Claim status")),
        sec(P(["{{claim_next_steps}}"]) + cta("Open my claim", "{{portal_url}}/claims/{{claim_ref}}", "Questions? Call " + PHONE + " or WhatsApp " + WHATSAPP + ".")),
    ],
)

template(
    "otp", "Customer",
    "Your Protecta Bode verification code: {{otp_code}}",
    "{{otp_code}} is your Protecta Bode one-time code. It expires in 10 minutes.",
    "lock", "Your verification code",
    lambda: [
        sec(P(["Hi {{first_name}},", "Use this one-time code to verify your phone number. It expires in <strong>10 minutes</strong>."])),
        sec(f"""
                                        <tr>
                                          <td height="10" style="height: 10px; font-size: 1px; line-height: 1px;">&nbsp;</td>
                                        </tr>
                                        <tr>
                                          <td align="left" valign="top" style="mso-line-height-rule: exactly;">
                                            <table border="0" cellspacing="0" cellpadding="0" role="presentation"><tbody><tr>
                                              <td align="center" bgcolor="{NAVY}" style="border-radius: 14px; padding: 16px 30px; font-family: {FONT_DISPLAY}; font-size: 34px; font-weight: 600; letter-spacing: 10px; color: #ffffff; line-height: 40px; mso-line-height-rule: exactly;">{{{{otp_code}}}}</td>
                                            </tr></tbody></table>
                                          </td>
                                        </tr>"""),
        sec(P(["Didn't request this code? Someone may have entered your number by mistake - you can safely ignore this email. Never share this code with anyone; the Protecta Bode team will <strong>never</strong> ask for it."]) ),
    ],
)

template(
    "password-reset", "Customer",
    "Reset your Protecta Bode password",
    "We received a request to reset your Protecta Bode portal password.",
    "lock", "Reset your password",
    lambda: [
        sec(P(["Hi {{first_name}},", "We received a request to reset the password for your Protecta Bode portal account (<strong>{{email}}</strong>). This link is valid for <strong>30 minutes</strong> and can be used once."]) + cta("Choose a new password", "{{reset_url}}")),
        sec(P(["Didn't request a reset? Your account is safe - ignore this email and the link will expire on its own."])),
    ],
)

template(
    "kyc-verified", "Customer",
    "Identity verified - you're all set to buy cover",
    "Your Protecta Bode identity check is complete. You can now buy and manage cover.",
    "users", "Identity verified",
    lambda: [
        sec(P(["Hi {{first_name}},", "Your identity check is <strong>complete</strong> - thank you. Your Protecta Bode account is now fully active, which means you can buy cover, renew, and report claims without further checks."])),
        sec(detail_rows([
            ("Full name", "{{full_name}}"),
            ("ID type", "{{id_type}}"),
            ("Verified", "{{verified_at}}"),
        ], header="Verification record")),
        sec(P(["Your ID images are handled by our secure verification partner and are never stored in the Protecta Bode portal, in line with the Uganda Data Protection and Privacy Act."]) + cta("Buy cover now", "{{portal_url}}/quote")),
    ],
)

# ══ AGENT ═════════════════════════════════════════════════════════════════════
template(
    "agent-application-received", "Agent",
    "Protecta Bode agent application received",
    "We have received your Protecta Bode agent application. Our distribution team is reviewing it.",
    "users", "Application received",
    lambda: [
        sec(P(["Hi {{agent_name}},", "Thank you for applying to become a <strong>Protecta Bode agent</strong>. We have received your details and your IRA agency licence information is under review by our distribution team."])),
        sec(detail_rows([
            ("Applicant", "{{agent_name}}"),
            ("Phone", "{{phone}}"),
            ("Licence no.", "{{licence_no}}"),
            ("Submitted", "{{submitted_at}}"),
        ], header="Application summary") + reference_box("Application reference", "{{application_ref}}")),
        sec(P(["<strong>What happens next</strong>"]) + bullets([
            "We verify your identity (KYC) and your IRA agency licence - usually within 3 working days.",
            "You'll get your agent portal login by SMS and email once approved.",
            "You can then quote, share and sell Protecta Bode - and earn commission on every policy sold.",
        ])),
        sec(signoff("The Protecta Bode distribution team<br />Liberty General Insurance Uganda")),
    ],
)

template(
    "agent-approved", "Agent",
    "You're approved - start selling Protecta Bode today",
    "Your Protecta Bode agent account is active. Log in, quote your first customer and start earning.",
    "shield", "You're approved",
    lambda: [
        sec(P(["Hi {{agent_name}},", "Great news - your Protecta Bode agent account is <strong>active</strong>. You can now quote and sell Protecta Bode to customers on behalf of Liberty General Insurance Uganda."])),
        sec(detail_rows([
            ("Agent code", "{{agent_code}}"),
            ("Commission rate", "{{commission_rate}}"),
            ("Portal", "{{portal_url}}/agent"),
        ], header="Your agent account")),
        sec(P(["<strong>How selling works</strong>"]) + bullets([
            "Quote a customer in under a minute - you only need their car value.",
            "Share the quote link or WhatsApp message - the customer pays directly.",
            "Commission accrues automatically the moment their payment is confirmed.",
        ]) + cta("Open my agent portal", "{{portal_url}}/agent", "First month target: {{target_count}} policies. You've got this.")),
    ],
)

template(
    "agent-sale", "Agent",
    "Commission earned - {{customer_first_name}} is covered",
    "{{customer_first_name}} completed payment for {{plate}}. {{commission_ugx}} commission accrued to your account.",
    "wallet", "Commission earned",
    lambda: [
        sec(P(["Hi {{agent_name}},", "<strong>{{customer_first_name}}</strong> has paid and their Protecta Bode cover for <strong>{{plate}}</strong> is active - because you moved them from quote to covered. Nice work."])),
        sec(detail_rows([
            ("Policy number", "{{policy_no}}"),
            ("Premium", "{{premium_ugx}}"),
            ("Your commission", "<strong style=\"font-size:17px;\">{{commission_ugx}}</strong>"),
            ("Status", "Accrued - payable {{payout_date}}"),
        ], header="This sale")),
        sec(detail_rows([
            ("Month to date", "{{mtd_policies}} policies · {{mtd_commission_ugx}}"),
        ], header="Your month")),
        sec(P(["Commissions are paid out monthly once the policy passes its 14-day cooling period."]) + cta("See my book of business", "{{portal_url}}/agent/commissions")),
    ],
)

template(
    "commission-statement", "Agent / Broker",
    "Your Protecta Bode commission statement - {{statement_month}}",
    "Your {{statement_month}} commission statement is ready: {{total_commission_ugx}} across {{policy_count}} policies.",
    "invoice", "Your commission statement",
    lambda: [
        sec(P(["Hi {{partner_name}},", "Your commission statement for <strong>{{statement_month}}</strong> is ready. The full PDF is attached and also available in your portal."])),
        sec(detail_rows([
            ("Partner", "{{partner_name}} ({{partner_type}})"),
            ("Policies sold", "{{policy_count}}"),
            ("Premium written", "{{premium_written_ugx}}"),
            ("Commission earned", "<strong style=\"font-size:17px;\">{{total_commission_ugx}}</strong>"),
            ("Status", "{{statement_status}}"),
        ], header="Statement summary")),
        sec(detail_rows([
            ("New business", "{{new_business_ugx}}"),
            ("Renewals", "{{renewal_commission_ugx}}"),
            ("Adjustments / clawback", "{{adjustments_ugx}}"),
        ], header="Breakdown")),
        sec(P(["Payment is made to your registered bank account by the <strong>{{payout_date}}</strong>. Discrepancies must be raised within 7 days of this statement."]) + cta("View full statement", "{{portal_url}}/commissions/{{statement_id}}")),
    ],
)

# ══ BROKER ════════════════════════════════════════════════════════════════════
template(
    "broker-fleet-quote", "Broker",
    "Fleet quote ready - {{fleet_count}} vehicles, {{fleet_total_ugx}}/year",
    "The Protecta Bode fleet quote for {{client_name}} is ready for your review and sharing.",
    "invoice", "Fleet quote ready",
    lambda: [
        sec(P(["Hi {{broker_name}},", "The fleet quote for <strong>{{client_name}}</strong> is ready. All {{fleet_count}} vehicles are priced at <strong>1.5% of value</strong> and can be bound in one payment or individually."])),
        sec(detail_rows([
            ("Client", "{{client_name}}"),
            ("Vehicles quoted", "{{fleet_count}}"),
            ("Total annual premium", "<strong style=\"font-size:17px;\">{{fleet_total_ugx}}</strong>"),
            ("Your commission", "{{fleet_commission_ugx}}"),
            ("Quote valid until", "{{quote_expires}}"),
        ], header="Fleet quote summary")),
        sec(P(["Share the quote pack with your client from the portal - they can accept online, and each vehicle is issued its own policy and motor certificate as payment confirms."]) + cta("Open fleet quote", "{{portal_url}}/broker/quotes/{{quote_ref}}", "Need a rate review for a large fleet? Reply to your partnership manager.")),
    ],
)

template(
    "client-expiry-report", "Broker",
    "Renewals due - {{expiry_report_month}} report for {{brokerage}}",
    "{{expiring_count}} of your clients' policies expire within 30 days. Protect their cover - and your renewal commission.",
    "calendar", "Renewals coming up",
    lambda: [
        sec(P(["Hi {{broker_name}},", "<strong>{{expiring_count}}</strong> policies under <strong>{{brokerage}}</strong> expire in the next 30 days - worth <strong>{{expiring_premium_ugx}}</strong> in renewal premium. The full list is in your portal, sorted by expiry date."])),
        sec(detail_rows([
            ("Expiring in 7 days", "{{expiring_7}}"),
            ("Expiring in 30 days", "{{expiring_30}}"),
            ("Lapsed last month", "{{lapsed_last_month}}"),
            ("Renewal retention", "{{retention_rate}}"),
        ], header="{{expiry_report_month}} at a glance")),
        sec(P(["Customers get automatic reminders at 30, 14, 3 and 0 days - but a call from you closes fastest. One tap on a client in the report starts a renewal quote with their details filled in."]) + cta("Open expiry report", "{{portal_url}}/broker/renewals", "You are receiving this report as the appointed broker of record.")),
    ],
)

# ══ HELPDESK ══════════════════════════════════════════════════════════════════
template(
    "ticket-received", "Helpdesk (to customer)",
    "We received your request - ticket {{ticket_ref}}",
    "Your Protecta Bode support request has been logged. Our helpdesk responds within one working day.",
    "mail_open", "We've got your request",
    lambda: [
        sec(P(["Hi {{first_name}},", "Thank you for reaching out. Your request has been logged and our helpdesk is on it."])),
        sec(detail_rows([
            ("Ticket", "{{ticket_ref}}"),
            ("Subject", "{{ticket_subject}}"),
            ("Channel", "{{ticket_channel}}"),
            ("Response by", "{{response_due}}"),
        ], header="Your ticket")),
        sec(P(["We reply within <strong>one working day</strong>. Updates come by email and WhatsApp - you can also add notes or attachments to the ticket from your portal."]) + cta("View my ticket", "{{portal_url}}/support/{{ticket_ref}}", "Urgent? Call " + PHONE + " quoting your ticket reference.")),
    ],
)

template(
    "ticket-resolved", "Helpdesk (to customer)",
    "Resolved - ticket {{ticket_ref}}",
    "Your Protecta Bode support request has been resolved. Let us know if you need anything else.",
    "shield", "All sorted",
    lambda: [
        sec(P(["Hi {{first_name}},", "Good news - we've resolved your request: <strong>{{ticket_subject}}</strong>."])),
        sec(detail_rows([
            ("Ticket", "{{ticket_ref}}"),
            ("Resolved", "{{resolved_at}}"),
            ("Handled by", "{{agent_name}}"),
        ], header="Ticket summary")),
        sec(P(["{{resolution_summary}}"])),
        sec(P(["Happy with how we handled it? <a href=\"{{survey_url}}\" style=\"color: " + ORANGE + "; font-weight: 700;\">Tell us in 30 seconds</a> - it helps us serve you better. Need something else? Just reply to open the ticket again."] )),
    ],
)

template(
    "helpdesk-escalation", "Helpdesk (internal)",
    "[{{priority}}] Escalation {{ticket_ref}} - {{customer_name}}",
    "Escalated ticket assigned to the Protecta Bode helpdesk. SLA {{sla_hours}}h.",
    "alert", "Escalation assigned",
    lambda: [
        sec(P(["Team,", "Ticket <strong>{{ticket_ref}}</strong> has been escalated to the helpdesk queue and needs an owner."])),
        sec(detail_rows([
            ("Priority", "<strong style=\"color:" + ORANGE + ";\">{{priority}}</strong>"),
            ("SLA", "{{sla_hours}} hours"),
            ("Customer", "{{customer_name}} ({{customer_phone}})"),
            ("Policy", "{{policy_no}} - {{plate}}"),
            ("Partner", "{{partner_name}} ({{partner_type}})" if True else ""),
            ("Raised via", "{{ticket_channel}}"),
            ("Subject", "{{ticket_subject}}"),
        ], header="Ticket context")),
        sec(P(["<strong>Summary</strong><br />{{issue_summary}}"])),
        sec(P(["First response is due by <strong>{{response_due}}</strong>. Assign yourself in the console before starting work so customers don't get duplicate replies."] ) + cta("Open in admin console", "{{console_url}}/support/{{ticket_ref}}")),
    ],
)


# ══ BILLING ═══════════════════════════════════════════════════════════════════
template(
    "invoice", "Customer / Broker",
    "Invoice {{invoice_no}} - Protecta Bode premium",
    "Invoice {{invoice_no}} for {{bill_to_name}}: {{total_ugx}} due {{due_date}}. Pay by MTN MoMo, Airtel Money or bank transfer.",
    "invoice", "Invoice {{invoice_no}}",
    lambda: [
        sec(P(["Hi {{bill_to_name}},", "Here is your Protecta Bode invoice. Payment is due by <strong>{{due_date}}</strong> - your cover (or fleet issue) completes automatically once payment is confirmed."])),
        sec(detail_rows([
            ("Invoice date", "{{invoice_date}}"),
            ("Due date", "{{due_date}}"),
            ("Policy / quote ref", "{{policy_or_quote_ref}}"),
            ("Issued to", "{{bill_to_name}} ({{bill_to_type}})"),
        ], header="Invoice details")),
        sec(line_items(
            [
                ("{{item_desc}}", "{{item_qty}}", "{{item_unit}}", "{{item_amount}}"),
            ],
            totals=[
                ("Subtotal", "{{subtotal_ugx}}", False),
                ("Tax / levies", "{{tax_ugx}}", False),
                ("Total due", "{{total_ugx}}", True),
            ],
        )),
        sec(P(["<strong>How to pay</strong> - MTN MoMo or Airtel Money: approve the prompt we send to {{payer_phone}}. Bank transfer: <strong>Stanbic Bank Uganda</strong>, account 9030005603063, using your invoice number as the payment reference."]) + reference_box("Payment reference", "{{invoice_no}}")),
        sec(P(["Queries on this invoice must reach the helpdesk within 7 days at " + PHONE + " or " + EMAIL_ADDR + "."]) + cta("Pay this invoice", "{{pay_url}}", "Generated {{invoice_date}} · Protecta Bode by Liberty General Insurance Uganda.")),
    ],
)


# ── Write files + preview gallery ────────────────────────────────────────────
def build() -> None:
    os.makedirs(HERE, exist_ok=True)
    index_cards = {"Customer": [], "Agent": [], "Broker": [], "Agent / Broker": [], "Helpdesk (to customer)": [], "Helpdesk (internal)": []}
    for t in TEMPLATES:
        html_out = render_email(
            title=t["subject"], preheader=t["preheader"], icon_name=t["icon_name"],
            heading=t["heading"], sections=[s for s in t["sections"]()],
        )
        path = os.path.join(HERE, f"{t['name']}.html")
        with open(path, "w", encoding="utf-8") as f:
            f.write(html_out)
        print(f"  wrote {t['name']}.html ({len(html_out):,} bytes)")
        index_cards.setdefault(t["audience"], []).append(t)

    # gallery
    groups = ""
    for audience, items in index_cards.items():
        if not items:
            continue
        rows = "".join(
            f'<li><a href="{t["name"]}.html" target="preview">{t["name"]}.html<br /><small>{esc(t["subject"])}</small></a></li>'
            for t in items
        )
        groups += f'<section><h2>{esc(audience)}</h2><ul class="list">{rows}</ul></section>'
    gallery = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Protecta Bode · Email template pack</title>
<style>
:root{{--navy:#0B1C48;--orange:#CA6E2B;--sky:#EEF8FB;--line:#BCDCE7;--muted:#56607F}}
*{{box-sizing:border-box;margin:0}}
body{{font-family:system-ui,Arial,sans-serif;background:var(--sky);color:#162044}}
header{{background:var(--navy);color:#fff;padding:18px 24px;display:flex;gap:14px;align-items:baseline;flex-wrap:wrap}}
header h1{{font-size:19px;font-weight:600}} header span{{font-size:12.5px;opacity:.75}}
.layout{{display:grid;grid-template-columns:290px 1fr;gap:0;min-height:calc(100vh - 62px)}}
nav{{background:#fff;border-right:1px solid var(--line);padding:18px;overflow:auto}}
section{{margin-bottom:22px}} h2{{font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}}
.list{{list-style:none;padding:0;display:grid;gap:6px}}
.list a{{display:block;border:1px solid var(--line);border-radius:10px;padding:9px 12px;text-decoration:none;color:var(--navy);font-weight:600;font-size:13.5px;line-height:1.3}}
.list a small{{display:block;color:var(--muted);font-weight:400;font-size:11.5px;margin-top:2px}}
.list a:hover,.list a:focus{{border-color:var(--navy)}}
iframe{{width:100%;height:calc(100vh - 62px);border:0;background:#fff}}
.hint{{font-size:11.5px;color:var(--muted);margin-top:16px;line-height:1.5}}
@media (max-width:820px){{.layout{{grid-template-columns:1fr}}iframe{{height:80vh}}}}
</style></head><body>
<header><h1>Protecta Bode - email template pack</h1><span>{len(TEMPLATES)} templates · design system: 660px table · navy/orange · Hugeicons · dark-mode ready</span></header>
<div class="layout"><nav>{groups}
<p class="hint">Merge tags use <code>{{{{like_this}}}}</code>. The logo resolves to <code>assets/protecta-bode-logo-on-white.png</code> (extracted from “Protecta Bode on white .svg”); the email service rewrites it to the hosted URL at send time.</p>
</nav><iframe name="preview" src="welcome.html" title="Template preview"></iframe></div>
</body></html>"""
    with open(os.path.join(HERE, "index.html"), "w", encoding="utf-8") as f:
        f.write(gallery)
    print(f"  wrote index.html gallery ({len(TEMPLATES)} templates)")


if __name__ == "__main__":
    build()
