if (!customElements.get('product-form')) {
  customElements.define(
    'product-form',
    class ProductForm extends HTMLElement {
      constructor() {
        super();

        this.form = this.querySelector('form');
        this.variantIdInput = this.form.querySelector('[name=id]');
        if (this.variantIdInput) this.variantIdInput.disabled = false;
        
        this.form.addEventListener('submit', this.onSubmitHandler.bind(this));
        this.cart = document.querySelector('cart-notification') || document.querySelector('cart-drawer');
        this.submitButton = this.querySelector('[type="submit"]');
        this.submitButtonText = this.submitButton ? this.submitButton.querySelector('span') : null;

        if (document.querySelector('cart-drawer') && this.submitButton) {
            this.submitButton.setAttribute('aria-haspopup', 'dialog');
        }

        this.hideErrors = this.dataset.hideErrors === 'true';

        // Initialize the UploadKit upload protection
        this.initUploadKitProtection();
      }

      initUploadKitProtection() {
        if (!this.submitButton || !this.submitButtonText) return;

        setInterval(() => {
          // Look for standard UploadKit / Uploadcare loading indicators in the DOM
          const isUploading = 
            document.querySelector('.uploadkit-uploading') ||
            document.querySelector('.uploadcare--progress') ||
            document.querySelector('.uploadcare--widget_status_started') ||
            document.querySelector('[data-upload-status="uploading"]');

          if (isUploading) {
            // Lock the button
            this.submitButton.disabled = true;
            this.submitButton.setAttribute('aria-disabled', 'true');
            this.submitButton.classList.add('opacity-50'); // visual dimming
            
            if (!this.submitButton.dataset.uploadLocked) {
              this.submitButton.dataset.originalText = this.submitButtonText.innerHTML;
              this.submitButtonText.innerHTML = 'Uploading File...';
              this.submitButton.dataset.uploadLocked = 'true';
            }
          } else {
            // Unlock the button once uploading is gone
            if (this.submitButton.dataset.uploadLocked === 'true') {
              this.submitButton.disabled = false;
              this.submitButton.removeAttribute('aria-disabled');
              this.submitButton.classList.remove('opacity-50');
              
              // Restore original text
              this.submitButtonText.innerHTML = this.submitButton.dataset.originalText || 'Add to Cart';
              delete this.submitButton.dataset.uploadLocked;
            }
          }
        }, 500); // Check every half second
      }

      onSubmitHandler(evt) {
        evt.preventDefault();
        
        // --- 1. UPLOAD PROTECTION FALLBACK ---
        // If the user presses "Enter" on an input field while it's uploading, block it.
        if (this.submitButton && this.submitButton.dataset.uploadLocked === 'true') {
            alert('Please wait for your file to finish uploading before adding to cart.');
            return;
        }

        if (this.submitButton && (this.submitButton.getAttribute('aria-disabled') === 'true' || this.submitButton.disabled)) return;

        this.handleErrorMessage();

        if (this.submitButton) {
            this.submitButton.setAttribute('aria-disabled', true);
            this.submitButton.classList.add('loading');
        }
        
        const spinner = this.querySelector('.loading__spinner');
        if (spinner) spinner.classList.remove('hidden');

        const config = fetchConfig('javascript');
        config.headers['X-Requested-With'] = 'XMLHttpRequest';
        delete config.headers['Content-Type'];

        const formData = new FormData(this.form);

        // --- 2. BULLETPROOF FIX: FORCE CAPTURE UPLOADKIT & CUSTOM FIELDS ---
        this.querySelectorAll('[name^="properties["]').forEach((field) => {
            if (field.value && field.value.trim() !== '') {
                formData.set(field.name, field.value);
            }
        });

        document.querySelectorAll('.uploadkit-upload-field [name^="properties["], .uploadkit [name^="properties["]').forEach((field) => {
            if (field.value && field.value.trim() !== '') {
                formData.set(field.name, field.value);
            }
        });
        // ----------------------------------------------------------------

        if (this.cart) {
          formData.append(
            'sections',
            this.cart.getSectionsToRender().map((section) => section.id)
          );
          formData.append('sections_url', window.location.pathname);
          this.cart.setActiveElement(document.activeElement);
        }
        config.body = formData;

        fetch(`${routes.cart_add_url}`, config)
          .then((response) => response.json())
          .then((response) => {
            if (response.status) {
              publish(PUB_SUB_EVENTS.cartError, {
                source: 'product-form',
                productVariantId: formData.get('id'),
                errors: response.errors || response.description,
                message: response.message,
              });
              this.handleErrorMessage(response.description);

              if (this.submitButton) {
                  const soldOutMessage = this.submitButton.querySelector('.sold-out-message');
                  if (!soldOutMessage) return;
                  this.submitButton.setAttribute('aria-disabled', true);
                  if (this.submitButtonText) this.submitButtonText.classList.add('hidden');
                  soldOutMessage.classList.remove('hidden');
              }
              this.error = true;
              return;
            } else if (!this.cart) {
              window.location = window.routes.cart_url;
              return;
            }

            const startMarker = CartPerformance.createStartingMarker('add:wait-for-subscribers');
            if (!this.error)
              publish(PUB_SUB_EVENTS.cartUpdate, {
                source: 'product-form',
                productVariantId: formData.get('id'),
                cartData: response,
              }).then(() => {
                CartPerformance.measureFromMarker('add:wait-for-subscribers', startMarker);
              });
            this.error = false;
            const quickAddModal = this.closest('quick-add-modal');
            if (quickAddModal) {
              document.body.addEventListener(
                'modalClosed',
                () => {
                  setTimeout(() => {
                    CartPerformance.measure("add:paint-updated-sections", () => {
                      this.cart.renderContents(response);
                    });
                  });
                },
                { once: true }
              );
              quickAddModal.hide(true);
            } else {
              CartPerformance.measure("add:paint-updated-sections", () => {
                this.cart.renderContents(response);
              });
            }
          })
          .catch((e) => {
            console.error(e);
          })
          .finally(() => {
            if (this.submitButton) {
                this.submitButton.classList.remove('loading');
                if (!this.error && this.submitButton.dataset.uploadLocked !== 'true') {
                    this.submitButton.removeAttribute('aria-disabled');
                }
            }
            if (this.cart && this.cart.classList.contains('is-empty')) this.cart.classList.remove('is-empty');
            if (spinner) spinner.classList.add('hidden');

            CartPerformance.measureFromEvent("add:user-action", evt);
          });
      }

      handleErrorMessage(errorMessage = false) {
        if (this.hideErrors) return;

        this.errorMessageWrapper =
          this.errorMessageWrapper || this.querySelector('.product-form__error-message-wrapper');
        if (!this.errorMessageWrapper) return;
        this.errorMessage = this.errorMessage || this.errorMessageWrapper.querySelector('.product-form__error-message');

        this.errorMessageWrapper.toggleAttribute('hidden', !errorMessage);

        if (errorMessage) {
          this.errorMessage.textContent = errorMessage;
        }
      }
    }
  );
}