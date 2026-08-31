variable "name" {
  description = "Name for the server, volume, firewall and SSH key."
  type        = string
  default     = "spideryarn-box"
}

variable "server_type" {
  description = <<-TXT
    CX53 is 16 shared vCPU / 32GB / 320GB, EUR 29.49/mo net (add 20% UK VAT).
    It is the TOP of the CX line — there is nothing above it. The next rung with
    more RAM is CCX43 at EUR 275.99/mo net, a 9x jump, so plan to swap the
    server under the volume rather than expecting a bigger CX.
    Prices verified 2026-08-31; Hetzner repriced on 15 June 2026 and a rescale
    moves a grandfathered server onto current pricing.
  TXT
  type        = string
  default     = "cx53"
}

variable "image" {
  type        = string
  default     = "ubuntu-24.04"
}

variable "location" {
  description = "fsn1 (Falkenstein) is ~22ms from London; hel1 (Helsinki) is ~45ms."
  type        = string
  default     = "fsn1"
}

variable "username" {
  description = "Non-root user that owns the sessions. Claude Code refuses to start as root with --dangerously-skip-permissions."
  type        = string
  default     = "greg"
}

variable "ssh_public_key_path" {
  type    = string
  default = "~/.ssh/id_ed25519.pub"
}

variable "ssh_source_ips" {
  description = <<-TXT
    Who may reach SSH and mosh. Defaults to the whole internet because a home
    IP is usually dynamic. Narrow it to "your.ip/32" whenever you can — it is
    the single biggest reduction in exposure available here, and it costs one
    `terraform apply` to change back.
  TXT
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

variable "volume_size_gb" {
  description = <<-TXT
    Holds /home: repos, node_modules, ~/.claude, browser profiles. EUR 0.044/GB/mo
    net, so 50GB is about EUR 2.20/mo. Volumes grow but never shrink.
  TXT
  type        = number
  default     = 50
}

variable "swap_gb" {
  description = <<-TXT
    Swap is the cheap insurance against the known failure mode: N sessions x M
    MCP servers spawns unbounded Node processes, and the OOM killer takes the
    box out. Swap turns a hard kill into a slowdown you can notice and act on.
  TXT
  type        = number
  default     = 8
}

variable "node_major" {
  type    = number
  default = 22
}

variable "timezone" {
  type    = string
  default = "Europe/London"
}
