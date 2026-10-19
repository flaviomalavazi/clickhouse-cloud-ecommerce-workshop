{{/*
Labels every pod carries. `deployment` and `service.name` are the ones the
ClickStack Kubernetes guide asks for: the node collector's k8sattributes
processor turns pod labels into resource attributes, so a stdout log line from a
pod arrives already tagged with the service that wrote it.

`otel.logs: otlp` marks the pods that already send their logs over OTLP (with trace
ids); the node collector skips their stdout so each line is stored once.
Call with (dict "name" <deployment name> "serviceName" <OTel service.name>
["otlpLogs" true]).
*/}}
{{- define "clickshop.podLabels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/part-of: clickshop
deployment: {{ .name }}
service.name: {{ .serviceName }}
{{- if .otlpLogs }}
otel.logs: otlp
{{- end }}
{{- end }}

{{- define "clickshop.selectorLabels" -}}
app.kubernetes.io/name: {{ . }}
{{- end }}

{{/*
Kubernetes attributes on the app's own telemetry (ClickStack guide, "Forwarding
resource tags to pods"). The Downward API hands the pod's identity to the process,
and OTEL_RESOURCE_ATTRIBUTES puts it on every span, log record and metric. HyperDX
opens the infrastructure tab for rows that carry k8s.pod.uid or k8s.node.name.
OTEL_RESOURCE_ATTRIBUTES must come after the variables it expands.
*/}}
{{- define "clickshop.k8sEnv" -}}
- name: POD_NAME
  valueFrom:
    fieldRef: { fieldPath: metadata.name }
- name: POD_UID
  valueFrom:
    fieldRef: { fieldPath: metadata.uid }
- name: POD_NAMESPACE
  valueFrom:
    fieldRef: { fieldPath: metadata.namespace }
- name: NODE_NAME
  valueFrom:
    fieldRef: { fieldPath: spec.nodeName }
- name: DEPLOYMENT_NAME
  valueFrom:
    fieldRef: { fieldPath: "metadata.labels['deployment']" }
- name: OTEL_RESOURCE_ATTRIBUTES
  value: k8s.pod.name=$(POD_NAME),k8s.pod.uid=$(POD_UID),k8s.namespace.name=$(POD_NAMESPACE),k8s.node.name=$(NODE_NAME),k8s.deployment.name=$(DEPLOYMENT_NAME)
{{- end }}

{{/* Where the app sends OTLP. */}}
{{- define "clickshop.otlpEnv" -}}
- name: OTEL_EXPORTER_OTLP_ENDPOINT
  value: {{ .Values.telemetry.otlpEndpoint | quote }}
{{- end }}

{{/* Every key of the Secret built from .env (credentials and the optional tuning). */}}
{{- define "clickshop.envFrom" -}}
- secretRef:
    name: {{ .Values.secretName }}
{{- end }}

{{- define "clickshop.image" -}}
{{ .name }}:{{ .root.Values.image.tag }}
{{- end }}
