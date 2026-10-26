"""PayU South Africa Redirect Payment Page SOAP client.

PayU credentials are read only on the server. No browser response is trusted as
proof of payment; every entitlement is based on getTransaction.
"""

import os
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


PLANS = {
    "monthly": {"label": "30 days", "amount_cents": 1000, "days": 30},
    "annual": {"label": "365 days", "amount_cents": 10000, "days": 365},
    "once": {"label": "Lifetime", "amount_cents": 1000, "days": None},
}

SOAP_NS = "http://schemas.xmlsoap.org/soap/envelope/"
PAYU_NS = "http://soap.api.controller.web.payjar.com/"
WSSE_NS = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
PASSWORD_TYPE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText"
SUPPORTED_METHODS = {"CREDITCARD", "DISCOVERYMILES", "EBUCKS", "EFT", "MASTERPASS", "RCS", "EFT_PRO",
                     "MOBICRED", "MPESA", "FASTA", "PAYFLEX", "MORETYME", "MOBICRED_VIRTUAL_CREDIT", "OPEN_BANKING"}


class PayUError(Exception):
    pass


def configured():
    return all(os.getenv(name, "").strip() for name in ("PAYU_SA_SAFEKEY", "PAYU_SA_SOAP_USERNAME", "PAYU_SA_SOAP_PASSWORD"))


def _endpoint():
    staging = os.getenv("PAYU_SA_ENVIRONMENT", "production").lower() == "staging"
    host = "staging.payu.co.za" if staging else "secure.payu.co.za"
    return f"https://{host}/service/PayUAPI", f"https://{host}/rpp.do"


def _child(parent, name, value):
    ET.SubElement(parent, name).text = str(value)


def _call(method, reference, *, amount_cents=None, return_url=None, cancel_url=None, email=None):
    if not configured():
        raise PayUError("PayU checkout is not configured")
    envelope = ET.Element(f"{{{SOAP_NS}}}Envelope")
    header = ET.SubElement(envelope, f"{{{SOAP_NS}}}Header")
    security = ET.SubElement(header, f"{{{WSSE_NS}}}Security")
    token = ET.SubElement(security, f"{{{WSSE_NS}}}UsernameToken")
    _child(token, f"{{{WSSE_NS}}}Username", os.environ["PAYU_SA_SOAP_USERNAME"].strip())
    password = ET.SubElement(token, f"{{{WSSE_NS}}}Password", {"Type": PASSWORD_TYPE})
    password.text = os.environ["PAYU_SA_SOAP_PASSWORD"].strip()
    body = ET.SubElement(envelope, f"{{{SOAP_NS}}}Body")
    call = ET.SubElement(body, f"{{{PAYU_NS}}}{method}")
    _child(call, "Api", "ONE_ZERO")
    _child(call, "Safekey", os.environ["PAYU_SA_SAFEKEY"].strip())
    if method == "setTransaction":
        _child(call, "TransactionType", "PAYMENT")
    info = ET.SubElement(call, "AdditionalInformation")
    _child(info, "merchantReference", reference)
    if method == "setTransaction":
        _child(info, "returnUrl", return_url)
        _child(info, "cancelUrl", cancel_url)
        _child(info, "redirectChannel", "responsive")
        _child(info, "secure3d", "true")
        methods = [value.strip().upper() for value in os.getenv("PAYU_SA_PAYMENT_METHODS", "CREDITCARD").split(",")]
        if not methods or any(value not in SUPPORTED_METHODS for value in methods):
            raise PayUError("PayU payment methods are not configured correctly")
        _child(info, "supportedPaymentMethods", ",".join(methods))
        customer = ET.SubElement(call, "Customer")
        if email:
            _child(customer, "email", email)
        basket = ET.SubElement(call, "Basket")
        _child(basket, "amountInCents", amount_cents)
        _child(basket, "currencyCode", "ZAR")
        _child(basket, "description", "Arounus Premium HD")
    endpoint, _ = _endpoint()
    request = urllib.request.Request(endpoint, ET.tostring(envelope, encoding="utf-8", xml_declaration=True),
                                     {"Content-Type": "text/xml; charset=utf-8", "SOAPAction": f'"{method}"'}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            document = ET.fromstring(response.read(512000))
    except (urllib.error.URLError, TimeoutError, ET.ParseError) as exc:
        raise PayUError("PayU is unavailable. Please try again later.") from exc
    if document.find(f".//{{{SOAP_NS}}}Fault") is not None:
        raise PayUError("PayU rejected this transaction. Please try again later.")
    result = document.find(".//return")
    if result is None:
        raise PayUError("PayU returned an unexpected response")
    return result


def _text(element, path):
    value = element.findtext(path)
    return (value or "").strip()


def start(reference, amount_cents, return_url, cancel_url, email):
    result = _call("setTransaction", reference, amount_cents=amount_cents,
                   return_url=return_url, cancel_url=cancel_url, email=email)
    payu_reference = _text(result, "payUReference")
    if _text(result, "successful").lower() != "true" or not payu_reference or _text(result, "merchantReference") != reference:
        raise PayUError("PayU could not start the payment")
    _, payment_url = _endpoint()
    return payu_reference, payment_url + "?" + urllib.parse.urlencode({"PayUReference": payu_reference})


def verify(reference):
    result = _call("getTransaction", reference)
    return {
        "merchant_reference": _text(result, "merchantReference"),
        "payu_reference": _text(result, "payUReference"),
        "state": _text(result, "transactionState"),
        "successful": _text(result, "successful").lower() == "true",
        "transaction_type": _text(result, "transactionType"),
        "amount_cents": _text(result, "basket/amountInCents"),
        "currency": _text(result, "basket/currencyCode"),
    }
