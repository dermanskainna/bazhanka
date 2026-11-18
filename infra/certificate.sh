#!/bin/sh
# ACM certificate helper for a custom CloudFront domain (used by the Makefile).
#
#   infra/certificate.sh find   DOMAIN   print the ARN of an ISSUED certificate for DOMAIN (or nothing)
#   infra/certificate.sh zone   DOMAIN   print the id of the public Route 53 zone that holds DOMAIN (or nothing)
#   infra/certificate.sh ensure DOMAIN   find, or request a DNS-validated certificate, add the validation
#                                        record to Route 53 and wait until it is issued; prints the ARN
#
# Environment: AWS_CLI (the aws command, the Makefile passes its docker wrapper), AWS_CERT_REGION
# (CloudFront only accepts certificates from us-east-1). Public ACM certificates are free; a Route 53
# hosted zone costs $0.50/month, so only use a custom domain if you already have one there.
set -eu

AWS_CLI=${AWS_CLI:-aws}
REGION=${AWS_CERT_REGION:-us-east-1}
cmd=${1:-}
domain=$(printf '%s' "${2:-}" | tr 'A-Z' 'a-z' | sed 's/\.$//')

if [ -z "$cmd" ] || [ -z "$domain" ]; then
  echo "usage: $0 find|zone|ensure DOMAIN" >&2
  exit 2
fi

aws() { $AWS_CLI "$@" | tr -d '\r'; }
clean() { tr -d '[:space:]' | sed 's/^None$//'; }

find_cert() {
  aws acm list-certificates --region "$REGION" --certificate-statuses ISSUED \
    --query "CertificateSummaryList[?DomainName=='$domain'].CertificateArn | [0]" --output text | clean
}

find_zone() {
  # Longest public zone name that is a suffix of the domain.
  aws route53 list-hosted-zones --query 'HostedZones[?Config.PrivateZone==`false`].[Id,Name]' --output text |
    while read -r id name; do
      name=$(printf '%s' "$name" | sed 's/\.$//')
      case "$domain" in
        "$name" | *."$name") printf '%s %s\n' "${#name}" "${id##*/}" ;;
      esac
    done | sort -rn | head -n 1 | cut -d' ' -f2
}

case "$cmd" in
  find) find_cert ;;
  zone) find_zone ;;
  ensure)
    arn=$(find_cert)
    if [ -n "$arn" ]; then echo "$arn"; exit 0; fi

    zone=$(find_zone)
    if [ -z "$zone" ]; then
      echo "No public Route 53 hosted zone for $domain. Create one (or validate the certificate by hand in the ACM console)." >&2
      exit 1
    fi

    # Reuse a request that is still waiting for validation instead of creating a new one each run.
    arn=$(aws acm list-certificates --region "$REGION" --certificate-statuses PENDING_VALIDATION \
      --query "CertificateSummaryList[?DomainName=='$domain'].CertificateArn | [0]" --output text | clean)
    if [ -z "$arn" ]; then
      token=$(printf '%s' "$domain" | tr -cd 'a-z0-9' | cut -c1-32)
      arn=$(aws acm request-certificate --region "$REGION" --domain-name "$domain" \
        --validation-method DNS --idempotency-token "${token:-bazhanka}" \
        --query CertificateArn --output text | clean)
      echo "Requested certificate $arn" >&2
    fi

    # ACM fills in the validation record a few seconds after the request.
    rec=""
    i=0
    while [ $i -lt 30 ]; do
      rec=$(aws acm describe-certificate --region "$REGION" --certificate-arn "$arn" \
        --query 'Certificate.DomainValidationOptions[0].ResourceRecord.[Name,Value]' --output text | sed 's/^None$//')
      [ -n "$rec" ] && break
      i=$((i + 1))
      sleep 5
    done
    if [ -z "$rec" ]; then echo "ACM did not return a validation record for $arn" >&2; exit 1; fi
    set -- $rec
    rec_name=$1
    rec_value=$2

    echo "Adding validation record $rec_name to zone $zone" >&2
    aws route53 change-resource-record-sets --hosted-zone-id "$zone" --change-batch \
      "{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$rec_name\",\"Type\":\"CNAME\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"$rec_value\"}]}}]}" \
      --query 'ChangeInfo.Status' --output text >&2

    echo "Waiting for the certificate to be issued (usually a few minutes)..." >&2
    aws acm wait certificate-validated --region "$REGION" --certificate-arn "$arn"
    echo "$arn"
    ;;
  *)
    echo "unknown command: $cmd (use find, zone or ensure)" >&2
    exit 2
    ;;
esac
