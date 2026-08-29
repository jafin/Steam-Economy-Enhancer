// The market history page.
//
// Steam paginates history, and the totals are only meaningful once every page has been
// read, so this observes the table and recounts as pages arrive.

import { steamPage } from '../steam/instance.ts';
import $ from 'jquery';
// Initialize the market history UI.
export function initializeMarketHistoryUI() {
    // Use jquery-observe (already included in SEE) to listen for AJAX DOM updates
    $('#tabContentsMyMarketHistory').observe('childlist subtree', () => {
        const controlsDiv = $('#tabContentsMyMarketHistory_controls');

        // Ensure the controls exist and we haven't already injected our jumper
        if (controlsDiv.length > 0 && $('#see_page_jump').length === 0) {
            const jumpContainer = $('<span id="see_page_jump"></span>');
            const input = $('<input type="number" min="1" placeholder="Page" />');
            const btn = $(
                '<span class="btn_green_white_innerfade btn_small" style="cursor: pointer;"><span>Jump</span></span>',
            );

            jumpContainer.append(input).append(btn);
            controlsDiv.append(jumpContainer);

            btn.on('click', () => {
                const targetPage = parseInt(String(input.val()));
                if (isNaN(targetPage) || targetPage < 1) {
                    return; // Fail silently
                }
                const targetIndex = targetPage - 1;

                steamPage.goToHistoryPage(targetIndex);
            });

            input.on('keypress', (e) => {
                if (e.which === 13) {
                    // Enter key
                    btn.click();
                }
            });
        }
    });
}
