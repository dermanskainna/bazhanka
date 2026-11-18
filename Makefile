-include .env

# Linux/macOS use the default /bin/sh. On Windows, make needs Git Bash: the default path below is
# "C:\Program Files\Git" (short 8.3 name, no spaces). If Git is installed elsewhere, put the path in
# .env, e.g.  GIT_BASH=d:/Git/bin/bash.exe
ifeq ($(OS),Windows_NT)
GIT_BASH ?= C:/PROGRA~1/Git/bin/bash.exe
SHELL := $(GIT_BASH)
endif

COMPOSE ?= docker compose -f infra/docker-compose.yml

PROJECT_NAME ?= bazhanka
AWS_REGION ?= us-east-1
AWS_DEFAULT_REGION ?= $(AWS_REGION)
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_REGION AWS_DEFAULT_REGION PROJECT_NAME

AWS ?= docker run --rm \
	-e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN \
	-e AWS_DEFAULT_REGION=$(AWS_REGION) \
	-v $(CURDIR):/aws -w /aws \
	amazon/aws-cli:latest

APP_STACK ?= $(PROJECT_NAME)-backend
ECR_STACK ?= $(PROJECT_NAME)-ecr
FRONTEND_STACK ?= $(PROJECT_NAME)-frontend
IMAGE_TAG ?= latest
AWS_LAMBDA_ARCH ?= x86_64
IMAGE_PLATFORM = $(if $(filter arm64,$(AWS_LAMBDA_ARCH)),linux/arm64,linux/amd64)
STACK_TAGS = --tags "PROJECT_NAME=$(PROJECT_NAME)"
# Extra flags for `cloudformation deploy` of the backend (aws-plan-backend sets --no-execute-changeset).
CFN_DEPLOY_FLAGS ?=
CERT = AWS_CLI="$(AWS)" AWS_CERT_REGION=us-east-1 sh infra/certificate.sh

stack-output = $(AWS) cloudformation describe-stacks --stack-name $(1) \
	--query 'Stacks[0].Outputs[?OutputKey==`$(2)`].OutputValue' --output text

wait-stack-idle = while status=$$($(AWS) cloudformation describe-stacks --stack-name $(1) \
		--query 'Stacks[0].StackStatus' --output text 2>/dev/null | tr -d '[:space:]'); \
		case "$$status" in *_IN_PROGRESS) true ;; *) false ;; esac; do \
		echo "$(1) is $$status — waiting..."; sleep 30; done

clear-failed-create = if [ "$$($(AWS) cloudformation describe-stacks --stack-name $(1) \
		--query 'Stacks[0].StackStatus' --output text 2>/dev/null | tr -d '[:space:]')" = ROLLBACK_COMPLETE ]; then \
		echo "$(1) failed earlier — deleting before retry"; \
		$(AWS) cloudformation delete-stack --stack-name $(1) && \
		$(AWS) cloudformation wait stack-delete-complete --stack-name $(1); fi

define require-aws-credentials
	@if [ -z "$(AWS_ACCESS_KEY_ID)" ] || [ -z "$(AWS_SECRET_ACCESS_KEY)" ]; then \
		echo "AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are empty — set them in .env"; exit 1; \
	fi
endef

define require-secrets
	@test -n "$(AWS_DB_PASSWORD)" || { echo "AWS_DB_PASSWORD is empty in .env"; exit 1; }
	@test -n "$(AWS_JWT_SECRET)" || { echo "AWS_JWT_SECRET is empty in .env (min 16 chars)"; exit 1; }
endef

.PHONY: up up-build down logs aws-whoami aws-ecr aws-push aws-plan-backend aws-deploy-backend aws-deploy-frontend aws-deploy aws-frontend-cert aws-logs aws-logs-edge aws-url aws-db-snapshot aws-destroy

up:
	$(COMPOSE) up
up-build:
	$(COMPOSE) up --build
down:
	$(COMPOSE) down
logs:
	$(COMPOSE) logs -f

aws-whoami:
	$(require-aws-credentials)
	$(AWS) sts get-caller-identity

aws-ecr:
	$(require-aws-credentials)
	$(AWS) cloudformation deploy \
		--stack-name $(ECR_STACK) \
		--template-file infra/ecr.yml \
		--no-fail-on-empty-changeset \
		$(STACK_TAGS) \
		--parameter-overrides "ProjectName=$(PROJECT_NAME)"

aws-push: aws-ecr
	$(require-aws-credentials)
	@repo=$$($(call stack-output,$(ECR_STACK),RepositoryUri) | tr -d '[:space:]'); \
		echo "Pushing $$repo:$(IMAGE_TAG) ($(IMAGE_PLATFORM))"; \
		$(AWS) ecr get-login-password | docker login --username AWS --password-stdin "$${repo%%/*}"; \
		docker build --platform $(IMAGE_PLATFORM) --provenance=false \
			-f backend/Dockerfile.lambda -t "$$repo:$(IMAGE_TAG)" ./backend; \
		docker push "$$repo:$(IMAGE_TAG)"

aws-deploy-backend: aws-push
	$(require-aws-credentials)
	$(require-secrets)
	@vpc=$$($(AWS) ec2 describe-vpcs --filters Name=isDefault,Values=true \
			--query 'Vpcs[0].VpcId' --output text | tr -d '[:space:]'); \
		subnets=$$($(AWS) ec2 describe-subnets \
			--filters Name=vpc-id,Values=$$vpc Name=default-for-az,Values=true \
			--query 'Subnets[].SubnetId' --output text | tr '[:space:]' ',' | sed 's/,*$$//'); \
		repo=$$($(call stack-output,$(ECR_STACK),RepositoryUri) | tr -d '[:space:]'); \
		digest=$$($(AWS) ecr describe-images --repository-name "$${repo#*/}" \
			--image-ids imageTag=$(IMAGE_TAG) --query 'imageDetails[0].imageDigest' \
			--output text | tr -d '[:space:]'); \
		echo "Deploying backend (image=$$repo@$$digest)..."; \
		$(call wait-stack-idle,$(APP_STACK)); \
		$(call clear-failed-create,$(APP_STACK)); \
		$(AWS) cloudformation deploy \
			--stack-name $(APP_STACK) \
			--template-file infra/backend.yml \
			--capabilities CAPABILITY_IAM \
			--no-fail-on-empty-changeset \
			$(CFN_DEPLOY_FLAGS) \
			$(STACK_TAGS) \
			--parameter-overrides \
				"ProjectName=$(PROJECT_NAME)" \
				"VpcId=$$vpc" \
				"SubnetIds=$$subnets" \
				"ImageUri=$$repo@$$digest" \
				"Architecture=$(AWS_LAMBDA_ARCH)" \
				"DbPassword=$(AWS_DB_PASSWORD)" \
				"JwtSecret=$(AWS_JWT_SECRET)" \
				"AdminEmails=$(AWS_ADMIN_EMAILS)" \
				"SerperApiKey=$(AWS_SERPER_API_KEY)" \
				"DonationUrl=$(AWS_DONATION_URL)" \
				"DonationLabel=$(or $(AWS_DONATION_LABEL),Support a volunteer cause)"
	@$(MAKE) --no-print-directory aws-url

# Dry run of the backend update: pushes the image, creates a change set WITHOUT applying it and lists
# what would change. Check that no database resource (DbCluster, DbInstance, DbSubnetGroup) says
# Replacement=True. Apply with `make aws-deploy-backend` (or delete the change set in the console).
aws-plan-backend:
	@$(MAKE) --no-print-directory aws-deploy-backend CFN_DEPLOY_FLAGS=--no-execute-changeset
	@cs=$$($(AWS) cloudformation list-change-sets --stack-name $(APP_STACK) \
			--query 'Summaries[-1].ChangeSetId' --output text | tr -d '[:space:]'); \
		$(AWS) cloudformation describe-change-set --change-set-name "$$cs" \
			--query 'Changes[].ResourceChange.[Action,LogicalResourceId,ResourceType,Replacement]' --output table

aws-frontend-cert:
	$(require-aws-credentials)
	@test -n "$(AWS_FRONTEND_DOMAIN)" || { echo "AWS_FRONTEND_DOMAIN is empty in .env"; exit 1; }
	@$(CERT) ensure "$(AWS_FRONTEND_DOMAIN)"

aws-deploy-frontend:
	$(require-aws-credentials)
	@backend_domain=$$($(call stack-output,$(APP_STACK),FunctionUrlDomain) 2>/dev/null | tr -d '[:space:]'); \
		test -n "$$backend_domain" -a "$$backend_domain" != "None" || { \
			echo "No backend found — run: make aws-deploy-backend"; exit 1; }; \
		edge_domain=$$($(call stack-output,$(APP_STACK),EdgeFunctionUrlDomain) 2>/dev/null | tr -d '[:space:]'); \
		test "$$edge_domain" != "None" || edge_domain=""; \
		domain=""; \
		if [ -n "$(AWS_FRONTEND_DOMAIN)" ]; then \
			cert=$$($(CERT) find "$(AWS_FRONTEND_DOMAIN)"); \
			test -n "$$cert" || { echo "No certificate — run: make aws-frontend-cert"; exit 1; }; \
			zone=$$($(CERT) zone "$(AWS_FRONTEND_DOMAIN)"); \
			domain="DomainName=$(AWS_FRONTEND_DOMAIN) CertificateArn=$$cert HostedZoneId=$$zone"; \
		fi; \
		$(call wait-stack-idle,$(FRONTEND_STACK)); \
		$(call clear-failed-create,$(FRONTEND_STACK)); \
		$(AWS) cloudformation deploy \
			--stack-name $(FRONTEND_STACK) \
			--template-file infra/frontend.yml \
			--no-fail-on-empty-changeset \
			$(STACK_TAGS) \
			--parameter-overrides \
				"ProjectName=$(PROJECT_NAME)" \
				"BackendDomain=$$backend_domain" \
				"EdgeDomain=$$edge_domain" \
				"PricingPlan=$(or $(AWS_CLOUDFRONT_PLAN),PAY_AS_YOU_GO)" \
				$$domain
	@bucket=$$($(call stack-output,$(FRONTEND_STACK),BucketName) | tr -d '[:space:]'); \
		dist=$$($(call stack-output,$(FRONTEND_STACK),DistributionId) | tr -d '[:space:]'); \
		echo "Building Vite frontend..."; \
		(cd frontend && npm ci && npm run build); \
		echo "Uploading frontend/dist to s3://$$bucket"; \
		$(AWS) s3 sync frontend/dist "s3://$$bucket" --delete --exclude "*.html" \
			--cache-control "public,max-age=31536000,immutable" --only-show-errors; \
		$(AWS) s3 sync frontend/dist "s3://$$bucket" --delete --exclude "*" --include "*.html" \
			--cache-control "no-cache" --only-show-errors; \
		$(AWS) cloudfront create-invalidation --distribution-id "$$dist" --paths "/*" \
			--query 'Invalidation.Status' --output text
	@$(MAKE) --no-print-directory aws-url

aws-deploy:
	@$(MAKE) --no-print-directory aws-deploy-backend
	@$(MAKE) --no-print-directory aws-deploy-frontend

aws-url:
	@echo "Site URL:     $$($(call stack-output,$(FRONTEND_STACK),SiteUrl) 2>/dev/null || echo 'not deployed yet')"
	@echo "Backend URL:  $$($(call stack-output,$(APP_STACK),ApiUrl) 2>/dev/null || echo 'not deployed yet')"

aws-logs:
	$(AWS) logs tail /aws/lambda/$(PROJECT_NAME)-backend --follow

aws-logs-edge:
	$(AWS) logs tail /aws/lambda/$(PROJECT_NAME)-edge --follow

# Manual snapshot of the Aurora cluster (kept until you delete it). Run before risky deploys.
aws-db-snapshot:
	$(require-aws-credentials)
	@id="$(PROJECT_NAME)-db-manual-$$(date -u +%Y%m%d-%H%M%S)"; \
		echo "Creating snapshot $$id..."; \
		$(AWS) rds create-db-cluster-snapshot --db-cluster-identifier $(PROJECT_NAME)-db \
			--db-cluster-snapshot-identifier "$$id" --query 'DBClusterSnapshot.Status' --output text && \
		$(AWS) rds wait db-cluster-snapshot-available --db-cluster-snapshot-identifier "$$id" && \
		echo "Snapshot $$id is available."

aws-destroy:
	$(require-aws-credentials)
	@printf 'Delete %s, %s, and %s (including Aurora DB)? Type yes: ' "$(FRONTEND_STACK)" "$(APP_STACK)" "$(ECR_STACK)"; \
		read answer; test "$$answer" = "yes" || { echo "Aborted."; exit 1; }
	@bucket=$$($(call stack-output,$(FRONTEND_STACK),BucketName) 2>/dev/null | tr -d '[:space:]'); \
		if [ -n "$$bucket" ] && [ "$$bucket" != "None" ]; then $(AWS) s3 rm "s3://$$bucket" --recursive --only-show-errors || true; fi
	-$(AWS) cloudformation delete-stack --stack-name $(FRONTEND_STACK)
	-$(AWS) cloudformation wait stack-delete-complete --stack-name $(FRONTEND_STACK)
	$(AWS) cloudformation delete-stack --stack-name $(APP_STACK)
	$(AWS) cloudformation wait stack-delete-complete --stack-name $(APP_STACK)
	$(AWS) cloudformation delete-stack --stack-name $(ECR_STACK)
	$(AWS) cloudformation wait stack-delete-complete --stack-name $(ECR_STACK)
	@echo "All stacks deleted."
